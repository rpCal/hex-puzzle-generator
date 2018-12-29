const path = require('path');

module.exports = {
  mode: "development",
  entry: path.join(__dirname, './src/app.ts'),
  devtool: 'inline-source-map',
  module: {
    rules: [
      {
        test: /\.ts?$/,
        use: 'ts-loader',
        exclude: /node_modules/
      }
    ]
  },
  output: {
    filename: 'build.js',
    path: path.resolve(__dirname, 'public/build')
  },
  resolve: {
    extensions: [ '.tsx', '.ts', '.js' ]
  },
  performance: { 
    hints: false 
  }
};