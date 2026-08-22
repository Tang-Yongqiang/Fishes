// Vite 配置：base 用相对路径 './'，使构建产物可部署到任意子路径
// （如 GitHub Pages 项目页 https://<user>.github.io/Fishes/），资源不依赖绝对根路径。
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // .glb/.gltf 等 3D 模型默认不在 Vite asset 列表，声明后 `?url` 导入才会拷贝进 dist。
  assetsInclude: ['**/*.glb', '**/*.gltf'],
});
