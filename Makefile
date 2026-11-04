.PHONY: ci check test preview package icons screenshots help

help:
	@echo "make ci       structural checks + tests (run before every commit)"
	@echo "make test     node:test suite only"
	@echo "make preview  serve the new tab page with fake Chrome data at http://127.0.0.1:8770/dev/preview.html"
	@echo "make package  zip extension/ into dist/"
	@echo "make icons    re-render extension/icons from assets/*.svg (needs rsvg-convert)"
	@echo "make screenshots  re-render docs/screenshots from dev/demo.js (needs make preview + Chrome)"

ci: check test

check:
	@scripts/check.sh

test:
	@node --test 'test/*.test.js'

preview:
	@python3 scripts/serve.py 8770

package:
	@scripts/package.sh

icons:
	@scripts/icons.sh

screenshots:
	@node scripts/screenshots.mjs
