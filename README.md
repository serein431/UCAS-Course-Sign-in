# 手机访问与登录排查

本项目是 [lccipher/UCAS-Course-Sign-in](https://github.com/lccipher/UCAS-Course-Sign-in) 的修改版，保留原 AGPL-3.0 许可证。

- 修改版源码：[serein431/UCAS-Course-Sign-in](https://github.com/serein431/UCAS-Course-Sign-in)。
- 手机访问：https://app.corvusapi.org/ucas。
- 已调整手机输入字号、按钮、课程卡片和二维码布局。显示密码按钮仅临时切换显示，不会存储密码。
- 账号优先使用学校邮箱，不要默认填写学号。学校登录错误会提供原因类别、学校错误码与请求编号。不要把密码发给维护者。
- `UPSTREAM_LOGIN_USER_NOT_FOUND`：学校未找到该账号。
- `UPSTREAM_LOGIN_PASSWORD_REJECTED`：学校提示密码错误。
- `UPSTREAM_LOGIN_ACCOUNT_RESTRICTED`：学校提示账号受限，请停止重复尝试。
- `UPSTREAM_LOGIN_INCOMPLETE`：学校称登录成功但未提供完整会话，不能认定为密码错误。
- `UPSTREAM_LOGIN_REJECTED`：学校拒绝登录但原因尚不能细分，请先验证同一账号能否登录官方课堂教学 App。
- 服务不会自动尝试其他密码，也不会在登录失败后提交签到。

## 保存登录状态

- 首次填写学校邮箱和密码，勾选“在这台设备保持登录”。登录成功后账号密码输入框收起，只留下当前账号、查询日期和退出按钮。
- 刷新页面或下次打开时读取Cookie，不重新发送密码。恢复状态只确认本工具保存的会话尚未过期，学校是否仍接受会话会在查询时验证。
- 保持登录的有效期最多7天，学校会话可能提前失效。取消勾选时使用浏览器会话Cookie，服务器有效期最多12小时；部分浏览器会恢复会话Cookie，公用设备用完后务必退出登录。
- 学校明确返回未登录、登录失效或HTTP 401/403时，撤销本工具会话并重新显示登录框。网络失败、普通课程查询错误不会自动清除登录状态；若学校只返回未知错误码，可手动退出后重新登录。
- Cookie只包含随机凭证，使用HttpOnly、SameSite=Strict，HTTPS部署使用Secure及安全前缀。学校用户ID、学校会话和账号加密保存在服务器，密码不写入Cookie、localStorage、会话文件或日志。
- “退出登录 / 换账号”会删除服务器会话并清除当前浏览器Cookie，复制的旧Cookie也不能继续用于本工具。此操作不是退出学校官方App，也不调用学校注销接口。
- 同一个域名和浏览器配置内共享登录，另一台设备或不同浏览器需要各自登录。其他标签页重新获得焦点时会检查本工具的保存状态。
- 服务器密钥及会话目录必须保留在发布目录之外，更新或重启服务不会清空有效会话。过期文件在读取或后续登录清理时删除。

## 同名课程与课次识别

- 一门课程可能有多条上课记录，数量按记录计算，不表示有多少门不同课程。
- 每条记录显示日期、时段和课次 ID；学校返回教室、班级或课程代码时也会显示，未返回则明确写“学校未提供”。
- UUID 不作为唯一选择标识。选择第二、第三条记录时，二维码与直接签到均使用那一条的7位课次 ID，而不是列表第一条的 ID。
- 只有整个原始 JSON 记录完全相同时才合并；同名、同 UUID、同课次 ID 都不足以单独判断重复。学校返回的信息无法区分时，保留记录并禁止选择，请核对官方课表。
- 修改账号或日期会清空旧结果和二维码；学校返回的日期与查询日期不符时不能选择。
- 日期来源优先使用学校返回的开始时间；只有时分或无开始时间时使用查询日期，不声称学校另行确认了日期。
- 查询接口新增 `upstreamTotal`（原记录数）、`duplicateCount`（完全重复数）、`sameNameGroups`（同名组数）。记录中的 `key` 只用于本次列表识别，不能作为学校签到编号。`courseId` 与课次 ID 分开保留，不用它代替签到目标。

部署方法见 [deploy/README.md](deploy/README.md)。

---

## 本机使用说明（本次修改）

- 日常使用优先在本机运行，服务仅监听 `127.0.0.1`，不对局域网开放。
- 启动：双击 `启动签到工具.command`；关闭终端会停止服务。首次运行需安装依赖并构建。
- 浏览器访问 `http://127.0.0.1:3000`。不要把学校密码发给他人，也不要写进脚本或命令行参数。
- `npm test` 只做本地测试，不访问学校、不提交签到。
- `npm run test:sign` 会真实登录并提交签到，必须显式传入 `--allow-real-sign`。凭据从 `UCAS_USERNAME`、`UCAS_PASSWORD` 环境变量读取。
- 直接签到需要7位课程ID；手动二维码支持7位ID或32位UUID。
- 时间修正默认3秒，页面、下载和后端共用同一份设置。这只是兼容原项目的默认值，未确认学校当前的时钟差。
- 二维码下载后请立即扫码。实际有效期及是否可签到由学校系统决定。
- 默认不信任 `X-Forwarded-For`。只有在可信代理会清除并重写该请求头时，才设置 `TRUST_PROXY_HEADERS=true`。内存请求限制不适合多实例公开服务。

---

# UCAS Course Sign in

UCAS 课程查询与签到二维码生成工具。

在线访问：[UCAS Course Sign in (Vercel)](https://ucas-sign-in.vercel.app/)

>[!CAUTION]
> **本项目仅供学习交流使用，请勿用于任何商业用途或非法用途。**

本项目用于复现 XXXX 的课程查询与签到链路，帮助用户在网页端完成以下流程：

1. 输入学校邮箱（或课堂教学 App 的账号）、密码和日期，查询当天课程
2. 选择课程，生成可实时刷新的签到二维码
3. 在可签到时间内直接发起签到
4. 手动输入课程 ID 或 UUID，生成对应签到码

## 运行截图

![亮色模式](./doc/img/light-mode.png)

![暗色模式](./doc/img/dark-mode.png)

![课程列表与二维码](./doc/img/course-list-qr.png)

## 快速开始

### 在线访问（推荐）

[UCAS Course Sign in (Vercel)](https://ucas-sign-in.vercel.app/)

### 本地运行

1. 克隆仓库并安装依赖

```bash
git clone https://github.com/lccipher/UCAS-Course-Sign-in
cd UCAS-Course-Sign-in
npm install
```

2. 启动开发环境

```bash
npm run dev
```

默认访问地址：`http://localhost:3000`

3. 生产构建与启动

```bash
npm run build
npm run start
```

4. 代码检查

```bash
npm run lint
```

### 部署上线（可选）

推荐使用 Vercel 进行部署，步骤如下：

1. Fork 本仓库到你的 GitHub 账号
2. 在 Vercel 导入项目
3. Framework 自动识别为 Next.js
4. Build Command 使用默认的 `npm run build`
5. 部署完成后访问生成的域名

## 工作流程

```text
Browser
	-> POST /api/course-uuid/session（首次登录，保存本工具会话）
		-> login.action (上游登录)
	-> POST /api/course-uuid/query（后续请求只带Cookie和日期）
		-> get_stu_course_sched.action (上游课表)
	<- 返回课程列表（已脱敏整理）
Browser
	-> 选择课程 / 手动输入课程 ID 或 UUID
	-> 本地生成签到 URL + QR Code
	-> POST /api/course-uuid/sign（可选，直接签到）
```

说明：

- 上游 `sessionId` 只在服务端使用；保持登录时加密保存，不回传前端。浏览器只得到本工具的随机会话凭证。
- 前端二维码和下载二维码都由本地生成，不依赖额外前端存储。
- 直接签到时优先使用保存的会话，再获取学校当前时间，不使用浏览器传入的时间戳。兼容命令行直接提交账号密码的旧接口，但不会自动保存该密码。

## 项目结构

```text
.
├─ src/
│  └─ app/
│     ├─ api/
│     │  └─ course-uuid/
│     │     ├─ query/
│     │     │  └─ route.ts      # 登录 + 课表查询接口
│     │     └─ sign/
│     │        └─ route.ts      # 登录 + 直接签到接口
│     ├─ globals.css            # 全局样式与主题变量
│     ├─ layout.tsx             # 字体、元信息、主题初始化
│     └─ page.tsx               # 主页面（查询、列表、二维码、签到）
├─ public/
├─ doc/
├─ package.json
└─ README.md
```

## API 说明

### /api/course-uuid/session

- `GET`：读取本工具的保存状态；不重新登录学校。只返回`authenticated`、账号和本工具的到期时间，不返回学校用户ID或学校会话。
- `POST`：使用`username`、`password`、`remember`（布尔值，默认true）登录学校，建立本工具会话并设置Cookie。受同源检查和登录次数限制保护。
- `DELETE`：撤销当前本工具会话，清除Cookie。登录到另一个账号时也撤销当前旧会话。
- 后续query只需`{"date":"20261015"}`，sign只需`{"courseSchedId":"1234567"}`；浏览器自动发送同源Cookie。
- 有效参数但缺少会话时返回401 `AUTH_REQUIRED`，明确的学校会话失效返回401 `SESSION_EXPIRED`。不保存或自动重试密码。

### POST /api/course-uuid/query

查询课程列表。

请求头：

- `Content-Type: application/json`

请求体：

```json
{
	"username": "student@example.edu.cn",
	"password": "your-password",
	"date": "20260325"
}
```

字段说明：

- `username`：学校邮箱或课堂教学 App 的账号，旧版命令行请求必填，最长254个字符；使用已登录Cookie时不传
- `password`：旧版命令行登录用密码；使用已登录Cookie时不传
- `date`：查询日期，支持 `yyyyMMdd` 或 `yyyy-MM-dd`

成功响应示例：

```json
{
	"date": "20260325",
	"total": 1,
	"upstreamTotal": 1,
	"duplicateCount": 0,
	"sameNameGroups": 0,
	"courses": [
		{
			"id": "1234567",
			"key": "generated-record-key",
			"date": "2026-03-25",
			"dateSource": "upstream",
			"classroomName": "示例教室",
			"className": "",
			"courseId": "",
			"courseCode": "",
			"sameNameCount": 1,
			"sameNameIndex": 1,
			"ambiguousIdentity": false,
			"canGenerate": true,
			"selectionIssue": "",
			"uuid": "CADD27F17ACC44EDAFxxxxxxxxxxxxxx",
			"courseName": "xxxxxxx",
			"teacherName": "xxx",
			"weekDay": "周三",
			"classBeginTime": "2026-03-25 10:25:00",
			"classEndTime": "2026-03-25 12:00:00",
			"signStatus": "1"
		}
	]
}
```

常见错误响应：

```json
{
	"message": "登录接口请求超时",
	"code": "UPSTREAM_LOGIN_TIMEOUT"
}
```

### POST /api/course-uuid/sign

发起直接签到。

请求头：

- `Content-Type: application/json`

请求体：

```json
{
	"username": "student@example.edu.cn",
	"password": "your-password",
	"courseSchedId": "1234567"
}
```

字段说明：

- `username`：学校邮箱或课堂教学 App 的账号，旧版命令行请求必填，最长254个字符；使用已登录Cookie时不传
- `password`：旧版命令行登录用密码；使用已登录Cookie时不传
- `courseSchedId`：课程 ID，必填，必须是 7 位数字字符串。UUID 仅用于手动生成二维码，不支持直接签到。

成功响应示例：

```json
{
	"success": true,
	"message": "签到成功",
	"upstreamStatus": "0",
	"result": {
		"stuSignId": "123456",
		"stuSignStatus": "1"
	}
}
```

可能的失败响应：

```json
{
	"success": false,
	"message": "签到失败，请稍后重试",
	"upstreamStatus": "1",
	"result": {
		"stuSignId": "123456",
		"stuSignStatus": "0"
	}
}
```

## 错误码与排查

### HTTP 状态码

- `400`：请求体或参数格式错误
- `401`：登录失败（账号密码错误或上游鉴权失败）
- `403`：非同源请求
- `409`：签到请求已提交，但状态未完成
- `415`：Content-Type 不是 JSON
- `429`：触发限流
- `502`：上游接口异常或返回异常
- `504`：上游接口超时
- `500`：服务内部异常

### 常见 `code`

- `RATE_LIMITED`
- `UPSTREAM_LOGIN_HTTP`
- `UPSTREAM_LOGIN_BAD_JSON`
- `UPSTREAM_LOGIN_TIMEOUT`
- `UPSTREAM_LOGIN_NETWORK`
- `UPSTREAM_SCHEDULE_HTTP`
- `UPSTREAM_SCHEDULE_BAD_SHAPE`：课表格式无法识别，不能当作无课
- `UPSTREAM_SCHEDULE_BAD_JSON`
- `UPSTREAM_SCHEDULE_TIMEOUT`
- `UPSTREAM_SCHEDULE_NETWORK`
- `UPSTREAM_SIGN_HTTP`
- `UPSTREAM_SIGN_BAD_JSON`
- `UPSTREAM_SIGN_TIMEOUT`
- `UPSTREAM_SIGN_NETWORK`
- `UNEXPECTED_ERROR`

## 技术栈

### 前端

- Next.js 16.4.0（App Router）
- React 19.2.4
- TypeScript 5
- Tailwind CSS 4
- next/font（Noto Sans SC / Noto Serif SC / IBM Plex Mono）

### 服务端

- Next.js Route Handler（Node.js runtime）
- 原生 Fetch + AbortController 超时控制
- 内存级限流（5 分钟窗口 + 每日上限）

### 工具链

- ESLint 9 + eslint-config-next
- qrcode 1.5.4（前端二维码生成）

## License

[AGPL-3.0 License](./LICENSE)
