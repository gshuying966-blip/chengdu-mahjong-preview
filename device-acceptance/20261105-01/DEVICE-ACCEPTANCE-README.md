# iPhone设备验收候选包

版本：P1-A-device-acceptance-20261105-01
storage_channel=device_acceptance
formal_approval.status=unapproved

这是未正式批准的iPhone设备验收候选包，不是正式发布包。本轮不得部署或用于正式20局，实际iPhone验收尚未完成。必须先独立审计，再另行授权设备验收或部署。

release.json是唯一权威运行时构建清单；其中files不包括release.json本身及本README/SHA256SUMS包装元数据。SHA256SUMS.txt记录ZIP内除自身外所有条目的SHA-256、字节数和相对路径。

游戏在浏览器本地通过Pyodide计算；首次加载仍可能请求外部固定版本CDN。当前未实测首次下载量，后续首次真机测试建议Wi-Fi并记录实际流量。ZIP不能直接作为iPhone Safari网页运行，未来HTTPS验收入口需要另行授权；本轮不部署、不真机测试。

本地学习数据可能被浏览器清理，设备模式与正式模式存储隔离。本包不含学习记录、题库答案、Git历史、账号凭据或浏览器资料。
