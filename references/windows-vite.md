# Windows 与 Vite 流程

## 同一板型的 STEP 转网页模型

需要 SolidCraft CLI、可运行项目转换脚本的 Python 与 NumPy，以及项目支持的 Node.js。将下面路径替换为本次输入和安装位置。若已拿到同一版的 SolidCraft 3MF，可以从转换步骤开始。

```powershell
$site = (Resolve-Path -LiteralPath 'D:\path\to\stm32-teaching-web').Path
$step = (Resolve-Path -LiteralPath 'D:\path\to\board.stp').Path
$cad = (Resolve-Path -LiteralPath 'D:\path\to\solidcraft-cli.exe').Path
$skill = (Resolve-Path -LiteralPath 'D:\path\to\stm32-teaching-model-deploy').Path
$work = (New-Item -ItemType Directory -Path (
  Join-Path ([IO.Path]::GetTempPath()) ('stm32-model-' + [guid]::NewGuid().ToString('N'))
)).FullName

$threeMf = Join-Path $work 'board.3mf'
$rawGlb = Join-Path $work 'board-uncompressed.glb'
$webGlb = Join-Path $work 'stm32.glb'
$measure = Join-Path $work 'measure.json'

& $cad run --in $step --out $threeMf --json-out $measure
if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $threeMf)) { throw 'SolidCraft 导出失败' }

python (Join-Path $site 'scripts\prepare_model.py') $threeMf $rawGlb
if ($LASTEXITCODE -ne 0) { throw '3MF 转换失败' }

npx --yes gltfpack@1.3.0 -i $rawGlb -o $webGlb -kn -km -gn 39 -si 0.15 -se 0.004 -vp 16 -cc
if ($LASTEXITCODE -ne 0) { throw 'GLB 压缩失败' }

$groups = 'board','mcu','power','motors','usb','host','h1','buzzer','display','switch'
$check = Join-Path $skill 'scripts\check-glb.mjs'
node $check $webGlb @groups
if ($LASTEXITCODE -ne 0) { throw '检查 GLB 资源与网页部件名称' }
```

`-kn` 保留命名节点，`-cc` 生成当前查看器已配置的 Meshopt 压缩。初版模型的网页几何约 1 MB。复杂模型根据实际渲染结果调整简化误差，重点检查焊脚、连接器开口和其他小特征。`measure.json` 中的 `bodies[].bbox` 为 SolidCraft 导入坐标下的毫米包围盒。将各体的最小和最大坐标做并集后，可与原始外形和网页比例对照。

### 更新板型或坐标时

- 当前转换器将 STEP 的 Z 轴映射到 glTF 的 Y 轴，以毫米读入并以米写入 GLB。`src/board.js` 将 GLB 放大 1000 倍，使浏览器场景按毫米处理。
- `src/lessons.js` 的 `anchor` 使用原 STEP 坐标。`src/board.js` 的 `stepToScene` 与转换脚本使用同一个原点和平面方向。`lift` 是场景里的毫米位移。更换原点或朝向时同步修改转换与热点映射。
- 当前查看器以 `getObjectByName` 找部件组，再拾取其后代网格。真实的多零件装配可按实例分组，未标位号的几何可先按外形留在板体组。位号和引脚以电气资料为准。记录外形标注与实际硬件版本的差异。
- 如需日后重建，按项目约定把独立几何的 3MF 留在 `model-source/`。网站运行用 `public/models/stm32.glb` 和静态预览图。

## 构建并检查实际访问地址

在已有站点替换输入前保留原模型。使用以下命令时，依赖尚未安装或锁文件变更后先执行 `npm ci`。

```powershell
Copy-Item -LiteralPath $webGlb -Destination (Join-Path $site 'public\models\stm32.glb') -Force
Set-Location -LiteralPath $site
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Vite 构建失败' }

node $check (Join-Path $site 'dist\models\stm32.glb') @groups
if ($LASTEXITCODE -ne 0) { throw '构建产物缺少有效模型' }

npm run preview
```

原项目的生产预览为 `http://127.0.0.1:5233/`。若端口已有该项目的进程，先检查它服务的目录和版本，按需重启该进程。使用新预览实例做对照时可以选择空闲测试端口。

另一个终端用实际地址检查模型下载。托管在子路径的站点要带完整路径前缀，资源链接使用站点现有的 Vite base 规则。

```powershell
node $check 'http://127.0.0.1:5233/models/stm32.glb' @groups
```

浏览器中确认 `.scene[data-model="ready"]`、实际可见的板卡、指定部件点击后的详情以及分解和回装。建议选取一个芯片和一个接口，用旋转及俯视两种视角检查坐标。模型 URL 返回状态 200 时，校验脚本能区分 GLB 与服务器的 HTML 回退页。网页显示静态图时，检查 GLB 请求、解码器兼容性及 WebGL 状态。
