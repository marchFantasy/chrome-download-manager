// ESLint 9+ 使用 Flat Config 格式
import js from '@eslint/js';
import globals from 'globals';

export default [
  // 忽略不需要检查的文件
  {
    ignores: [
      'node_modules/**',
      'eslint.config.js'  // 忽略配置文件本身
    ]
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        chrome: 'readonly',
        importScripts: 'readonly'  // Service Worker 全局函数
      }
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-undef': 'error'
    }
  }
];
