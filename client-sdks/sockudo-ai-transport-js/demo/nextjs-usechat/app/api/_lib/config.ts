export interface DemoConfig {
  appBaseUrl: string;
  appId: string;
  appKey: string;
  appSecret: string;
  channelName: string;
  host: string;
  port: number;
}

export const config: DemoConfig = {
  appBaseUrl:
    process.env.SOCKUDO_DEMO_APP_BASE_URL ??
    `http://127.0.0.1:${process.env.PORT ?? "5174"}`,
  appId: process.env.SOCKUDO_APP_ID ?? "demo-app",
  appKey: process.env.SOCKUDO_APP_KEY ?? "demo-key",
  appSecret: process.env.SOCKUDO_APP_SECRET ?? "demo-secret",
  channelName: process.env.SOCKUDO_CHANNEL_NAME ?? "private-ai-usechat",
  host: process.env.SOCKUDO_HOST ?? "127.0.0.1",
  port: Number(process.env.SOCKUDO_PORT ?? "6001"),
};
