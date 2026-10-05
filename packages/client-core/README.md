# @weiban/client-core

网页与管理后台共用的纯浏览器基础包：contracts驱动的参数/响应校验，IndexedDB会话与按账号隔离的数据，错误容错与精确微元输入。没有业务端点或供应商SDK。后台把cacheResponses关闭；所有调用显式经过contracts端点。用于浏览器的代码不依赖Node，fake-indexeddb仅用于测试。实现说明见docs/web/foundation.md。
