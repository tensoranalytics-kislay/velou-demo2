const path = require('path');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';

  return {
    entry: {
      index: './src/index.ts',
      'index.browser': './src/index.browser.ts',
      'cdn/loader': './src/CDN/loader.js',
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
      library: {
        name: 'VelouWidget',
        type: 'umd',
      },
      globalObject: 'this',
      clean: true,
    },
    externals: {
      react: {
        commonjs: 'react',
        commonjs2: 'react',
        amd: 'react',
        root: 'React',
      },
      'react-dom': {
        commonjs: 'react-dom',
        commonjs2: 'react-dom',
        amd: 'react-dom',
        root: 'ReactDOM',
      },
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: [
            isProduction ? MiniCssExtractPlugin.loader : 'style-loader',
            'css-loader',
          ],
        },
      ],
    },
    plugins: [
      ...(isProduction
        ? [
            new MiniCssExtractPlugin({
              filename: 'styles/[name].css',
            }),
          ]
        : []),
    ],
    optimization: {
      minimize: isProduction,
    },
    devtool: isProduction ? 'source-map' : 'eval-source-map',
  };
};

