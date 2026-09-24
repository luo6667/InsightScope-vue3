import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import vueParser from 'vue-eslint-parser';

/**
 * 📘 eslint.config.js —— ESLint 9 flat config（Vue 版）
 *
 * 对应关系：eslint-config-next + react-* 插件 → eslint-plugin-vue。
 * unplugin 生成的 dts 与构建产物不参与 lint。
 */
export default tseslint.config(
  {
    ignores: ['dist', 'node_modules', 'src/types/auto-imports.d.ts', 'src/types/components.d.ts'],
  },

  // 基础 JS/TS 规则
  // 注意：用 recommended（非 strictTypeChecked）——既有代码含 axios any / void promise 等写法，
  // 类型感知严格规则会产生大量噪声；需要更严时可改回 tseslint.configs.strictTypeChecked
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,vue}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2024,
      },
    },
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    rules: {
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
      // 允许不显式声明返回类型（TS 推导足够好）
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },

  // Vue SFC（eslint-plugin-vue 的 flat 预设 + TS parser）
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      // 组件名不强制多词（App.vue / Toaster 等）
      'vue/multi-word-component-names': 'off',
      // props 默认值用 withDefaults 表达，不必强制 require-default-prop
      'vue/require-default-prop': 'off',
      // 视图较长，单文件多根/属性换行交给 prettier 决定
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': [
        'error',
        { html: { void: 'always', normal: 'always', component: 'always' } },
      ],
    },
  },

  // Node 环境文件
  {
    files: ['vite.config.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Prettier 覆盖（必须放在最后）
  prettier,
);
