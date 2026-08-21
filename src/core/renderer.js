// 渲染器创建（通用 core）：WebGPU 优先，WebGL2 自动回退。
// 每个场景共用同一套渲染器创建逻辑，返回 { THREE, renderer, api }。

/**
 * 创建渲染器。
 * @param {{ preserveDrawingBuffer: boolean }} opts 截图/导出功能需要保留绘制缓冲
 * @returns {Promise<{ THREE, renderer, api }>}
 *   THREE  对应渲染后端的 three 模块（webgpu 或标准 three）
 *   renderer 渲染器实例（WebGPURenderer 或 WebGLRenderer）
 *   api     'WebGPU' | 'WebGL2'
 */
export async function createRenderer({ preserveDrawingBuffer = false } = {}) {
  let THREE;
  let renderer;
  let api = 'WebGL2';

  try {
    THREE = await import('three/webgpu');
    renderer = new THREE.WebGPURenderer({ antialias: true, preserveDrawingBuffer });
    await renderer.init();
    api = 'WebGPU';
  } catch (e) {
    console.warn('[鱼缸] WebGPU 不可用，回退到 WebGL2：', e);
    THREE = await import('three');
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer,
    });
  }

  return { THREE, renderer, api };
}
