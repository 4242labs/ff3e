.PHONY: build build-alfred

build:
	cd web && npm ci && npm run build

# Contract-equivalent to Alfred's Entropy Docker build stage.
build-alfred:
	cd web && npm ci && npm run build:alfred