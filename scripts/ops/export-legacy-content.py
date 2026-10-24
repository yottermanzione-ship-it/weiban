#!/usr/bin/env python3
"""Read-only, consistent legacy content snapshot. No credentials/passwords are exported."""
import argparse
import base64
import datetime
import gzip
import hashlib
import json
import os
import pathlib
import sqlite3
import urllib.parse


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--db', default='/opt/weiban-server/weiban.db')
    parser.add_argument('--root', default='/opt/weiban-server')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    root = pathlib.Path(args.root).resolve()
    output = pathlib.Path(args.output)
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    filename = output / 'content.jsonl.gz'
    if filename.exists():
        raise RuntimeError('REFUSE_OVERWRITE_SNAPSHOT')
    db = sqlite3.connect('file:' + str(pathlib.Path(args.db).resolve()) + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    db.text_factory = bytes
    db.execute('PRAGMA query_only=ON')
    db.execute('BEGIN')
    captured = datetime.datetime.now(datetime.timezone.utc).isoformat()
    queries = {
        'app_users': 'SELECT id,username,nickname,display_name,avatar_url,gender,region,birthday,signature,membership_level,membership_expire_at,created_at,updated_at FROM app_users ORDER BY id',
        'user_friends': 'SELECT * FROM user_friends ORDER BY user_id,persona_name',
        'chat_groups': 'SELECT * FROM chat_groups ORDER BY id',
        'chat_group_members': 'SELECT * FROM chat_group_members ORDER BY group_id,id',
        'chat_history': 'SELECT * FROM chat_history ORDER BY user_id,persona_name,id',
        'group_messages': 'SELECT * FROM group_messages ORDER BY group_id,created_at,id',
        'moments': 'SELECT * FROM moments ORDER BY created_at,id',
        'moment_interactions': 'SELECT * FROM moment_interactions ORDER BY created_at,id',
        'chat_read_cursors': 'SELECT * FROM chat_read_cursors',
        'user_memories': 'SELECT * FROM user_memories',
        'conversation_summaries': 'SELECT * FROM conversation_summaries',
        'persona_customizations': 'SELECT * FROM persona_customizations',
        'relationship_states': 'SELECT * FROM relationship_states',
        'user_character_voice_styles': 'SELECT * FROM user_character_voice_styles',
    }
    counts, sources = {}, set()
    invalid_utf8 = 0
    with gzip.open(filename, 'wt', encoding='utf-8', compresslevel=2) as stream:
        stream.write(json.dumps({'table': '_snapshot', 'row': {'capturedAt': captured, 'format': 'weiban-content-v1'}}) + '\n')
        for table, query in queries.items():
            count = 0
            for record in db.execute(query):
                row = dict(record)
                raw_fields = {}
                for field, value in list(row.items()):
                    if isinstance(value, bytes):
                        try:
                            row[field] = value.decode('utf-8')
                        except UnicodeDecodeError:
                            row[field] = value.decode('utf-8', errors='replace')
                            raw_fields[field] = base64.b64encode(value).decode('ascii')
                            invalid_utf8 += 1
                if raw_fields:
                    row['_legacy_invalid_utf8'] = raw_fields
                stream.write(json.dumps({'table': table, 'row': row}, ensure_ascii=False, separators=(',', ':')) + '\n')
                count += 1
                if not row.get('deleted_at'):
                    for field in ['media_path', 'audio_url', 'image_url', 'avatar_url', 'avatar']:
                        value = row.get(field)
                        if isinstance(value, str) and value.strip():
                            sources.add(value.strip())
            counts[table] = count
    db.close()
    assets, external, missing, ignored = [], [], [], []
    for source in sorted(sources):
        parsed = urllib.parse.urlsplit(source)
        if parsed.scheme in ('http', 'https'):
            external.append(source)
            continue
        name = urllib.parse.unquote(parsed.path)
        if name.startswith('/opt/weiban-server/'):
            candidate = pathlib.Path(name)
        elif name.startswith('/generated/'):
            candidate = root / 'public' / name.lstrip('/')
        else:
            ignored.append(source)
            continue
        resolved = candidate.resolve()
        if not resolved.is_relative_to(root) or candidate.is_symlink() or not resolved.is_file():
            missing.append(source)
            continue
        token = hashlib.sha256(source.encode('utf-8')).hexdigest()
        assets.append({'source': source, 'path': str(resolved), 'archive': 'media/' + token + resolved.suffix.lower(), 'bytes': resolved.stat().st_size})
    manifest = {'format': 'weiban-content-v1', 'capturedAt': captured, 'counts': counts, 'invalidUtf8FieldsPreserved': invalid_utf8, 'assets': assets, 'external': external, 'missing': missing, 'ignored': ignored}
    (output / 'content-manifest.json').write_text(json.dumps(manifest, ensure_ascii=True), encoding='utf-8')
    os.chmod(filename, 0o600)
    os.chmod(output / 'content-manifest.json', 0o600)
    digest = hashlib.sha256()
    with filename.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    print(json.dumps({'ok': True, 'capturedAt': captured, 'counts': counts, 'snapshotBytes': filename.stat().st_size, 'sha256': digest.hexdigest(), 'mediaFiles': len(assets), 'mediaBytes': sum(x['bytes'] for x in assets), 'externalMedia': len(external), 'missingMedia': len(missing), 'ignoredSources': len(ignored)}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'ok': False, 'errorType': type(error).__name__}))
        raise SystemExit(1)
