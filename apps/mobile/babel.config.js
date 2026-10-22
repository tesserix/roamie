module.exports = function (api) {
  const testing = api.env('test');
  return {
    presets: ['babel-preset-expo'],
    plugins: testing ? ['@babel/plugin-transform-dynamic-import'] : [],
  };
};
