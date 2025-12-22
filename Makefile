# --------------------------------------------------
# Thunderbird Add-on Makefile
# --------------------------------------------------

ADDON_NAME := odoo-mail-importer
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
  options.html \
  options.js \
  lib \
  $(ICON_DIR)

.PHONY: all check generate-icons xpi clean distclean

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

check:
	@command -v zip >/dev/null || \
	  (echo "ERROR: zip not installed" && exit 1)
	@command -v jq >/dev/null || \
	  (echo "ERROR: jq not installed (needed for version)" && exit 1)
	@command -v $(RSVG) >/dev/null || \
	  (echo "ERROR: rsvg-convert missing. Install librsvg2-bin" && exit 1)

# --------------------------------------------------
# Cleanup
# --------------------------------------------------

clean:
	rm -f $(PNG_ICONS)

distclean: clean
	rm -rf $(DIST_DIR)
