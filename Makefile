# --------------------------------------------------
# Thunderbird Add-on Makefile
# --------------------------------------------------

ADDON_NAME := odoo-mail-connector
VERSION := $(shell jq -r '.version' manifest.json)
DIST_DIR := dist
XPI := $(DIST_DIR)/$(ADDON_NAME)-$(VERSION).xpi

SVG_ICON := thunderbird2odoo.svg
ICON_DIR := icons
SIZES := 16 32 48 96 128
RSVG := rsvg-convert

PNG_ICONS := $(foreach s,$(SIZES),$(ICON_DIR)/odoo-$(s).png)

# Files to include in XPI
XPI_FILES := \
  manifest.json \
  background.js \
  displayScript.js \
  dialog.html \
  dialog.js \
  options.html \
  options.js \
  lib \
  $(ICON_DIR)

# JS source files to syntax-check
JS_FILES := background.js displayScript.js dialog.js options.js lib/mailCache.js lib/odooClient.js lib/odooMailUpload.js

.PHONY: all check check-js test generate-icons xpi clean clean-icons distclean

all: xpi
# --------------------------------------------------
# Icon generation
# --------------------------------------------------

generate-icons: $(PNG_ICONS)

$(ICON_DIR)/odoo-%.png: $(SVG_ICON) | $(ICON_DIR)
	@echo "Generating $@"
	$(RSVG) -w $* -h $* $(SVG_ICON) -o $@

$(ICON_DIR):
	mkdir -p $(ICON_DIR)

# --------------------------------------------------
# Build XPI
# --------------------------------------------------

xpi: check generate-icons
	@echo "Building XPI: $(XPI)"
	mkdir -p $(DIST_DIR)
	cd . && zip -r -9 $(XPI) $(XPI_FILES)

# --------------------------------------------------
# Checks
# --------------------------------------------------

check: check-js test
	@command -v zip >/dev/null || \
	  (echo "ERROR: zip not installed" && exit 1)
	@command -v jq >/dev/null || \
	  (echo "ERROR: jq not installed (needed for version)" && exit 1)
	@command -v $(RSVG) >/dev/null || \
	  (echo "ERROR: rsvg-convert missing. Install librsvg2-bin" && exit 1)

check-js:
	@command -v node >/dev/null || \
	  (echo "ERROR: node not installed (needed for JS syntax check)" && exit 1)
	@for f in $(JS_FILES); do \
	  node --check $$f || \
	    (echo "ERROR: syntax error in $$f" && exit 1); \
	  echo "ok: $$f"; \
	done

test:
	@command -v node >/dev/null || \
	  (echo "ERROR: node not installed (needed for tests)" && exit 1)
	node --test

# --------------------------------------------------
# Cleanup
# --------------------------------------------------

clean:
	rm -rf $(DIST_DIR)

# Also remove the generated PNG icons. The icons are committed to keep
# development setup simple, so this is a separate target: running 'make clean'
# must not dirty the working tree.
clean-icons:
	rm -f $(PNG_ICONS)

distclean: clean
