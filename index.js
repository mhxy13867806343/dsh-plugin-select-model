/**
 * dsh-plugin-select-model —— Host 半边入口。
 *
 * 空壳：本插件目前只有界面布局，逻辑全在客户端（client.js）——
 * 在模型菜单底部注入「添加模型」一行，并在点击后弹出服务商 / API Key 的填写弹窗。
 * 布局阶段不需要任何 Host 服务、路由、定时器或配置项，所以这里只保留一个空的
 * apply()，让 bundle 有一条能被 Loader 装载的入口。
 *
 * 后续如果要在 Host 侧持久化第三方服务商配置、或做连通性测试，
 * 再在这里注册对应的 connection 路由（届时记得补 inject: ['connection']）。
 */
export function apply() {}
