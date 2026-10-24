#!/usr/bin/env python3
"""Package only snapshot-referenced local media; never touch the source application files."""
import argparse
import hashlib
import json
import os
import pathlib
import tarfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--snapshot', required=True)
    args = parser.parse_args()
    directory = pathlib.Path(args.snapshot).resolve()
    manifest = json.loads((directory / 'content-manifest.json').read_text(encoding='utf-8'))
    output = directory / 'content-media.tar.gz'
    if output.exists():
        raise RuntimeError('REFUSE_OVERWRITE_MEDIA_PACKAGE')
    count, changed, missing = 0, [], []
    with tarfile.open(output, 'w:gz', compresslevel=1) as archive:
        for item in manifest['assets']:
            source = pathlib.Path(item['path'])
            target = pathlib.PurePosixPath(item['archive'])
            if not source.resolve().is_relative_to('/opt/weiban-server') or source.is_symlink() or target.is_absolute() or '..' in target.parts:
                raise RuntimeError('MEDIA_PATH_INVALID')
            if not source.is_file():
                missing.append(item['archive'])
                continue
            if source.stat().st_size != item['bytes']:
                changed.append(item['archive'])
                continue
            archive.add(source, arcname=str(target), recursive=False)
            count += 1
    os.chmod(output, 0o600)
    digest = hashlib.sha256()
    with output.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    report = {'ok': True, 'files': count, 'missingSinceSnapshot': missing, 'changedSinceSnapshot': changed, 'bytes': output.stat().st_size, 'sha256': digest.hexdigest()}
    (directory / 'content-media-package.json').write_text(json.dumps(report), encoding='utf-8')
    print(json.dumps(report))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'ok': False, 'errorType': type(error).__name__}))
        raise SystemExit(1)
