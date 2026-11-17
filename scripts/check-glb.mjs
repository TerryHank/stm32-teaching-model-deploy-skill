import { readFile } from 'node:fs/promises';

async function readModel(input) {
  if (!/^https?:\/\//i.test(input)) return readFile(input);

  const response = await fetch(input, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function parseGlb(bytes) {
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF') {
    throw new Error('响应或文件缺少 GLB 魔数');
  }
  if (bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) {
    throw new Error('GLB 版本或文件长度错误');
  }

  const jsonLength = bytes.readUInt32LE(12);
  const jsonEnd = 20 + jsonLength;
  if (bytes.toString('ascii', 16, 20) !== 'JSON' || jsonLength % 4 || jsonEnd > bytes.length) {
    throw new Error('GLB 的 JSON 块无效');
  }
  for (let offset = jsonEnd; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw new Error('GLB 块头不完整');
    const length = bytes.readUInt32LE(offset);
    offset += 8 + length;
    if (length % 4 || offset > bytes.length) throw new Error('GLB 块长度无效');
  }

  const model = JSON.parse(bytes.toString('utf8', 20, jsonEnd));
  if (model.asset?.version !== '2.0') throw new Error('缺少 glTF 2.0 资产声明');
  if ([...(model.buffers ?? []), ...(model.images ?? [])].some(
    ({ uri }) => uri !== undefined && !/^data:/i.test(uri)
  )) {
    throw new Error('该 GLB 引用了外部资源，需制作单文件网页模型');
  }
  return model;
}

function sceneNodes(model, roots) {
  const visited = new Set();
  const queue = [...roots];
  while (queue.length) {
    const index = queue.pop();
    if (visited.has(index)) continue;
    const node = model.nodes?.[index];
    if (!Number.isInteger(index) || !node) throw new Error('场景包含无效节点引用');
    visited.add(index);
    queue.push(...(node.children ?? []));
  }
  return [...visited];
}

function checkScene(model, groups) {
  const roots = model.scenes?.[model.scene ?? 0]?.nodes ?? [];
  const active = sceneNodes(model, roots);
  const hasMesh = (index) => {
    const mesh = model.meshes?.[model.nodes[index].mesh];
    return mesh?.primitives?.some(({ attributes }) =>
      (model.accessors?.[attributes?.POSITION]?.count ?? 0) > 0
    );
  };
  const meshes = active.filter(hasMesh);
  if (meshes.length === 0) throw new Error('活动场景缺少可绘制网格');

  for (const group of groups) {
    const matches = active.filter((index) => model.nodes[index].name === group);
    if (matches.length !== 1) {
      throw new Error(`活动场景中的部件节点 ${group} 出现 ${matches.length} 次`);
    }
    if (!sceneNodes(model, matches).some(hasMesh)) {
      throw new Error(`部件节点 ${group} 缺少网格`);
    }
  }
  return meshes.length;
}

async function main() {
  const [input, ...requested] = process.argv.slice(2);
  if (!input) throw new Error('用法：node check-glb.mjs <文件或HTTP地址> [部件ID ...]');

  const groups = [...new Set(requested)];
  const bytes = await readModel(input);
  const model = parseGlb(bytes);
  const meshNodes = checkScene(model, groups);
  console.log(JSON.stringify({
    bytes: bytes.length,
    meshNodes,
    requiredExtensions: model.extensionsRequired ?? [],
    checkedGroups: groups,
  }));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
