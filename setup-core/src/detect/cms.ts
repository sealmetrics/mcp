/**
 * CMS / ecommerce platform detection (RF-305). When SealMetrics already ships an
 * official plugin/module for the platform, neither the CLI nor the MCP edits
 * PHP/theme files (RF-306 / RF-3502) — they provision and point the user at the
 * plugin. Best-effort markers only; conservative (VAL-305).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Platform } from "../types.js";

/** Official plugin/module install hint per platform, surfaced in next_steps (RF-306 / RF-3502). */
export const PLATFORM_PLUGIN_HINT: Record<Platform, string> = {
  woocommerce:
    "Install the official SealMetrics for WooCommerce plugin and paste your account_id in its settings.",
  wordpress:
    "Install the official SealMetrics for WordPress plugin and paste your account_id in its settings.",
  prestashop:
    "Install the official SealMetrics PrestaShop module and paste your account_id in its settings.",
  magento2:
    "Install the official SealMetrics Magento 2 extension and paste your account_id in its settings.",
  drupal:
    "Install the official SealMetrics Drupal module and paste your account_id in its settings.",
  joomla:
    "Install the official SealMetrics Joomla plugin and paste your account_id in its settings.",
  opencart:
    "Install the official SealMetrics OpenCart extension and paste your account_id in its settings.",
};

export function detectPlatform(cwd: string): Platform | undefined {
  const has = (...rel: string[]) => rel.some((r) => existsSync(join(cwd, r)));

  // WordPress family (Woo is WordPress + the plugin dir).
  if (has("wp-config.php", "wp-content")) {
    if (has("wp-content/plugins/woocommerce", "wp-content/plugins/woocommerce/woocommerce.php")) {
      return "woocommerce";
    }
    return "wordpress";
  }

  // PrestaShop
  if (has("config/settings.inc.php", "app/config/parameters.php") && has("prestashop", "classes/PrestaShopAutoload.php")) {
    return "prestashop";
  }
  if (has("classes/PrestaShopAutoload.php")) return "prestashop";

  // Magento 2
  if (has("bin/magento", "app/etc/env.php") && has("app/etc/di.xml", "vendor/magento")) {
    return "magento2";
  }
  if (has("bin/magento")) return "magento2";

  // Drupal
  if (has("core/lib/Drupal.php")) return "drupal";

  // Joomla
  if (has("configuration.php") && has("libraries/joomla", "administrator/manifests")) {
    return "joomla";
  }

  // OpenCart
  if (has("system/startup.php") && has("catalog/controller")) return "opencart";

  return undefined;
}
