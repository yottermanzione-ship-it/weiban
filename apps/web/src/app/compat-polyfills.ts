// 页面与 Service Worker 各有自己的运行环境，两个入口都要在业务模块之前引入。
import 'core-js/modules/es.global-this.js';
import 'core-js/modules/es.array.at.js';
import 'core-js/modules/es.array.flat-map.js';
import 'core-js/modules/es.object.from-entries.js';
import 'core-js/modules/es.object.has-own.js';
import 'core-js/modules/es.promise.all-settled.js';
import 'core-js/modules/es.string.at-alternative.js';
import 'core-js/modules/es.string.match-all.js';
import 'core-js/modules/es.string.replace-all.js';
import 'core-js/modules/web.structured-clone.js';
