module.exports = {
  root: true,
  env: { node: true },
  // webpack 编译期把自由变量 `__webpack_public_path__` 改写成 `__webpack_require__.p`；
  // 源码里只写不读，声明成 writable 才不会被 eslint:recommended 判 no-global-assign / no-unused-vars。
  globals: { __webpack_public_path__: 'writable' },
  extends: ['plugin:vue/recommended', 'eslint:recommended'],
  parserOptions: { parser: 'babel-eslint' },
  rules: { 'no-console': 'off', 'vue/multi-word-component-names': 'off' },
}
