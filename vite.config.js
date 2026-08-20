// Vite 配置：base 用相对路径 './'，使构建产物可部署到任意子路径
// （如 GitHub Pages 项目页 https://<user>.github.io/Fishes/），资源不依赖绝对根路径。
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
});
