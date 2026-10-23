module.exports = {
  apps: [{
    name: "luko",
    script: "./dist/index.js",
    watch: false,
    env: {
      NODE_ENV: "production"
    }
  }]
};
