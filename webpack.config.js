//@ts-check

'use strict';

const path = require('path');

const extensionConfig = {
  name: 'extension',
  target: 'node',
  mode: 'none',
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2'
  },
  externals: { vscode: 'commonjs vscode' },
  resolve: { extensions: ['.ts', '.js'] },
  module: {
    rules: [{
      test: /\.ts$/,
      exclude: /node_modules/,
      use: [{ loader: 'ts-loader' }]
    }]
  },
  devtool: 'nosources-source-map',
  infrastructureLogging: { level: 'log' }
};

const chatConfig = {
  name: 'chat-webview',
  target: 'web',
  mode: 'none',
  entry: './src/webview/chat.ts',
  output: {
    path: path.resolve(__dirname, 'media'),
    filename: 'chat.js'
  },
  resolve: { extensions: ['.ts', '.js'] },
  module: {
    rules: [{
      test: /\.ts$/,
      exclude: /node_modules/,
      use: [{
        loader: 'ts-loader',
        options: { configFile: 'tsconfig.webview.json' }
      }]
    }]
  },
  devtool: 'nosources-source-map'
};

const issueComposerConfig = {
  name: 'issue-composer',
  target: 'web',
  mode: 'none',
  entry: './src/webview/issueComposer.ts',
  output: {
    path: path.resolve(__dirname, 'media'),
    filename: 'issueComposer.js'
  },
  resolve: { extensions: ['.ts', '.js'] },
  module: {
    rules: [{
      test: /\.ts$/,
      exclude: /node_modules/,
      use: [{
        loader: 'ts-loader',
        options: { configFile: 'tsconfig.webview.json' }
      }]
    }]
  },
  devtool: 'nosources-source-map'
};

module.exports = [extensionConfig, chatConfig, issueComposerConfig];
