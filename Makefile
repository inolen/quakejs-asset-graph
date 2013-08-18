.PHONY: lint

all: lint

lint:
	find lib -name "*.js" -print0 | xargs -0 jshint