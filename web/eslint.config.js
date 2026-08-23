import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactCompiler from 'eslint-plugin-react-compiler';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  // 全局忽略
  { ignores: ['dist', 'node_modules'] },

  // 基础 JS/TS 规则
  // 注意：用 recommended（非 strictTypeChecked）——既有代码含 axios any / void promise 等写法，
  // 类型感知严格规则会产生大量噪声；需要更严时可改回 tseslint.configs.strictTypeChecked
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2024,
      },
    },
    plugins: {
      react,
      'react-compiler': reactCompiler,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'simple-import-sort': simpleImportSort,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      // React
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      // React Compiler：编译期自动记忆化，hook 规则由编译器校验（memo 等手动优化不再需要）
      'react-compiler/react-compiler': 'error',
      // hooks v7 新增规则：既有代码在 effect 中同步 setState 是既定模式，保持行为不变
      'react-hooks/set-state-in-effect': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'react/no-unknown-property': ['error', { ignore: ['className'] }],

      // Import 排序
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',

      // TypeScript 调整（在 recommended 之上放宽部分规则）
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // React 19 + TS 中 prop-types 不再需要
      'react/prop-types': 'off',
      // 允许不显式声明返回类型（TS 推导足够好）
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },

  // Prettier 覆盖（必须放在最后）
  prettier,
);
