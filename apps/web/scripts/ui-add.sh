#!/usr/bin/env sh
# shadcn 4.21 rewrites its `@/lib/utils` import to the bare specifier "cn" under this alias layout,
# which would resolve to an unrelated npm package. Add components through this script instead.
set -eu
cd "$(dirname "$0")/.."
pnpm dlx shadcn@4.21.5 add "$@" --yes
grep -rl --include='*.tsx' --include='*.ts' -e 'from "cn"' -e "from 'cn'" src/shared | while read -r file; do
  sed -i.bak -e 's#from "cn"#from "@shared/lib/utils"#' -e "s#from 'cn'#from '@shared/lib/utils'#" "$file"
  rm -f "$file.bak"
done
if grep -q '"cn"' package.json; then pnpm remove cn; fi
pnpm exec prettier --write src/shared >/dev/null
