#!/bin/zsh
set -e
cd "${0:A:h}"
if ! command -v node >/dev/null && [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  source "$HOME/.nvm/nvm.sh"
fi
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo "未找到 Node.js 或 npm，请先安装 Node.js 20.9 或更新版本。"
  read "?按回车退出"
  exit 1
fi
if [[ ! -d node_modules ]]; then npm ci --ignore-scripts; fi
if [[ ! -f .next/BUILD_ID ]]; then npm run build; fi
if /usr/sbin/lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "3000端口已被使用；若是本工具，直接打开浏览器即可。"
  open http://127.0.0.1:3000
  read "?按回车退出"
  exit 0
fi
(sleep 2; open http://127.0.0.1:3000) &
echo "本机签到工具：http://127.0.0.1:3000"
echo "关闭此终端或按 Ctrl+C 可停止。电脑休眠、重启或移除外置硬盘会影响使用。"
exec npm run start
