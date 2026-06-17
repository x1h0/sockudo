.PHONY: demo demo-usechat demo-core demo-node demo-build docs local-usechat local-core local-node

demo: demo-usechat

demo-usechat:
	docker compose -f demo/docker-compose.yml up --build sockudo nextjs-usechat

demo-core:
	docker compose -f demo/docker-compose.yml up --build sockudo nextjs-core-sdk

demo-node:
	docker compose -f demo/docker-compose.yml up --build sockudo node-agent

local-usechat:
	pnpm --filter @sockudo/ai-transport-demo-nextjs-usechat dev

local-core:
	pnpm --filter @sockudo/ai-transport-demo-nextjs-core-sdk dev

local-node:
	pnpm --filter @sockudo/ai-transport-demo-node-agent dev

demo-build:
	pnpm demo:build

docs:
	pnpm docs:build
