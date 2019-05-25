module.exports = {
  apps: [{
    name: 'markbot',
    script: './index.js',
    env: {
      NODE_ENV: 'development',
    },
    env_production: {
      NODE_ENV: 'production',
    },
  }],
};
