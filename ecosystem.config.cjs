module.exports = {
  apps: [
    {
      name: "ai-aggregate-web",
      cwd: __dirname,
      script: "corepack",
      args: "pnpm start:web",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "ai-aggregate-api",
      cwd: __dirname,
      script: "corepack",
      args: "pnpm start:api",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
