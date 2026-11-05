const path = require('path')
const VueLoaderPlugin = require('vue-loader/lib/plugin')

module.exports = {
  mode: 'production',
  entry: './src/main.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'app.js',
    publicPath: './dist/',
  },
  module: {
    rules: [
      { test: /\.vue$/, loader: 'vue-loader' },
      { test: /\.css$/, use: ['style-loader', 'css-loader'] },
      { test: /\.(woff2?|ttf|eot|svg)$/, use: { loader: 'file-loader', options: { name: 'fonts/[name].[contenthash:8].[ext]', esModule: false } } },
    ],
  },
  plugins: [new VueLoaderPlugin()],
}
