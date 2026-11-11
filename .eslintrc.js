module.exports = {
  root: true,
  env: {
    node: true,
  },
  extends: ['plugin:vue/recommended', 'eslint:recommended'],
  parserOptions: {
    parser: 'babel-eslint',
  },
  overrides: [{
    files: ['src/index.js', 'src/web-component/index.js'],
    globals: { __webpack_public_path__: 'writable' },
  }],
  rules: {
    'no-console': 'off',
    'vue/multi-word-component-names': 'off',
  },
}
