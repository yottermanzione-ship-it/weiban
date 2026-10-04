// 仓库根 ESLint 配置：整个仓库共用 @weiban/eslint-config（含模块边界规则 R1～R9）。
// 子项目需要额外规则（例如网页的浏览器全局变量、React 规则）时，在下面追加带 files 限定的配置块。
import weiban from '@weiban/eslint-config';

export default [...weiban];
