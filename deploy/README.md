# qiu 部署

HTTPS 地址：https://app.corvusapi.org/ucas

- 构建变量：`NEXT_PUBLIC_BASE_PATH=/ucas BUILD_STANDALONE=true NEXT_TELEMETRY_DISABLED=1`。
- Node.js 24.14.1 独立安装在 `/opt/ucas-sign-in/runtime`，不改系统 Node.js。
- 源码和运行目录按版本保存在 `/opt/ucas-sign-in/releases`。
- `current` 指向当前独立运行目录。
- systemd 服务为 `ucas-sign-in`，仅监听 `127.0.0.1:19300`，开机自动启动。
- Apache 转发 `/ucas`，不修改其他应用的监听端口。
- `PUBLIC_ORIGIN=https://app.corvusapi.org` 明确指定允许的网页来源，避免多层代理改写 Host 导致同源请求被拒绝。
- 代理清除客户端指定的 IP 头，再写入真实连接 IP 和 HTTPS 协议。应用只在此受控代理后启用 `TRUST_PROXY_HEADERS=true`。
- 学校账号、密码、会话不写入日志。密码不保存；账号及学校会话只保存在加密的会话记录中，不放入部署配置。
- 访问者输入的密码会经过这台服务器再发送给学校。不要把它描述成只在手机本地处理。

## 查看和停止

```sh
ssh qiu 'systemctl status ucas-sign-in --no-pager'
ssh qiu 'journalctl -u ucas-sign-in -n 50 --no-pager'
ssh qiu 'systemctl stop ucas-sign-in'
```

更新需要重新构建，因为 basePath 被写入浏览器代码。切换 current 后重启服务即可；回退时指向旧运行目录。

本服务不保存学校密码。若官方 App 能登录但本工具仍拒绝，请提供学校错误码和页面请求编号，不要提供密码。

## 现有站点的请求头改写

这台服务器原来的 HTTPS 站点会提前把所有请求的 Origin 改成其他网站的地址，导致新服务的同源检查返回403。部署时已将这两条改写限定在 `/ucas` 以外，并保留其他路径的目标值：

```apache
RequestHeader set Origin "https://jmrai.net" "expr=%{REQUEST_URI} !~ m#^/ucas(?:/|$)#"
RequestHeader set Referer "https://jmrai.net/" "expr=%{REQUEST_URI} !~ m#^/ucas(?:/|$)#"
```

修改前的 Apache 配置保存在服务器 `/opt/ucas-sign-in/backups`。不要对 `/ucas` 强行覆盖 Origin，否则会掩盖不合法来源。

## 登录会话的运行目录

- `SESSION_KEY_FILE=/opt/ucas-sign-in/config/session.key`：32字节随机密钥，root创建，仅root与服务用户组可读；不复制到源码、Git或发布包。
- `SESSION_STORE_DIR=/opt/ucas-sign-in/sessions`：服务用户专用0700目录，会话文件0600，AES-256-GCM加密，只包含账号、学校用户ID、学校会话及本工具有效期；不含密码。
- `SESSION_COOKIE_PATH=/ucas`明确指定运行时Cookie范围，不能只依赖构建变量。
- systemd补充配置为`/etc/systemd/system/ucas-sign-in.service.d/session.conf`，设置以上三项Environment，并为会话目录增加ReadWritePaths。原服务的其他限制保持不变。
- 密钥和会话目录独立于`current`，更新或重启继续使用；不要随发布包重建密钥。换密钥会使旧会话不可读，需要重新登录。
- 公共服务必须显式配置以上两个路径，缺少配置时拒绝保存会话。本机默认使用git忽略的`.local/auth`。
- HTTPSCookie名为`__Secure-ucas_session`，Path为`/ucas`，没有Domain属性，只含256位随机凭证；退出时用相同名称和路径删除，并撤销服务器记录。
- 构建配置排除`.local`及`.env*`，运行时密钥读取明确不参加文件追踪；上传源码仍须排除这些路径。
- 回退至不支持会话的旧版本后，需要重新输入学校账号密码。旧会话目录及密钥可以保留，不要打印其内容排错。

本次范围修正会拒绝并撤销旧的根路径会话，清除旧根路径Cookie，首次更新后需要再登录一次。新会话与/ucas范围绑定；今后正常更新和重启仍保留有效会话。状态GET不覆盖当前/ucas凭证，只追加旧根路径Cookie的清除指令。

### Apache的Cookie改写例外

2026-10-07检查实际HTTPS响应时发现，现有站点的全局配置会把Cookie的Path改成`/`，并将SameSite=Strict改成Lax。应用测试并不能发现代理的这类改写。已在`/etc/apache2/sites-enabled/app.corvusapi.org.conf`将两项限制为`/ucas`以外的路径，其他路径保留原有行为：

```apache
<LocationMatch "^/(?!ucas(?:/|$))">
    ProxyPassReverseCookiePath / /
</LocationMatch>
Header edit Set-Cookie ";[ ]*SameSite=Strict" "; SameSite=Lax" "expr=%{REQUEST_URI} !~ m#^/ucas(?:/|$)#"
```

修改通过`apache2ctl configtest`后重新加载。实际HTTPS退出响应已检查：当前Cookie为Path=/ucas、HttpOnly、Secure、SameSite=Strict，同时发送旧根路径Cookie的删除指令。

由于修正前的Cookie曾被代理扩大到根路径，本次额外更换了一次会话密钥，让旧凭证失效，需要重新登录。以后正常发布不可重复更换密钥。配置备份为`/opt/ucas-sign-in/backups/app-corvus-session-cookie-*.conf`，旧密钥备份为同目录的`session-key-before-scope-fix-*.bin`，仅root可读，不上传或打印。回退Cookie配置时不要恢复旧密钥让旧凭证重新生效。
