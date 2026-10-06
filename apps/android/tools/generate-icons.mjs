/** Phosphor paths from the locked web icon package; MIT license retained beside this script. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const directory=resolve(root,'apps/android/app/src/main/res/drawable');
const check=process.argv.includes('--check');
mkdirSync(directory,{recursive:true});
for(const [name,id] of [['ChatCircle','chat'],['Users','contacts'],['Compass','discover'],['UserCircle','me']]) {
    const source=readFileSync(resolve(root,`apps/web/node_modules/@phosphor-icons/react/dist/defs/${name}.es.js`),'utf8');
    for(const weight of ['regular','fill']) {
        const segment=source.split(`"${weight}",`)[1]?.split('\n  ],')[0];
        const paths=[...segment.matchAll(/\bd:\s*"([^"]+)"/g)].map(match=>match[1]);
        if(paths.length===0)throw new Error(`Missing icon path ${name}/${weight}`);
        const xml='<!-- Phosphor Icons, MIT; converted from locked @phosphor-icons/react. -->\n< vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="256" android:viewportHeight="256">\n'.replace('< vector','<vector')+paths.map(d=>`    <path android:fillColor="#FF000000" android:pathData="${d}" />`).join('\n')+'\n</vector>\n';
        const file=resolve(directory,`ic_${id}_${weight}.xml`);
        if(check){if(readFileSync(file,'utf8')!==xml)throw new Error(`Generated icon differs: ${id}/${weight}`);}else writeFileSync(file,xml);
    }
}
