module.exports = {
  apps: [
    {
      name: "app-recetas-api",
      script: "server/index.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      watch: false,
      env: {
        NODE_ENV: "production",
        PORT: 3007,
      },
    },
  ],
};
