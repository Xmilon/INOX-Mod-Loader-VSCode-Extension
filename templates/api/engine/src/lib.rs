//! {name}: an API mod. Every event of horizon_mod_api::Mod has a default that does nothing;
//! write the ones you need.
use horizon_mod_api::{Action, Host, ItemStack, Mod};

pub fn create() -> Box<dyn Mod> {
    Box::new(MyMod)
}

struct MyMod;

impl Mod for MyMod {
    /// Right click with an item.
    fn use_item(&self, host: &mut dyn Host, stack: &ItemStack) -> Action {
        if &*stack.item != "minecraft:stick" {
            return Action::Pass;
        }
        host.feedback("{name}: the stick works");
        Action::Handled
    }

    /// A line under an item's tooltip.
    fn tooltip(&self, stack: &ItemStack, lines: &mut Vec<String>) {
        if &*stack.item == "minecraft:stick" {
            lines.push("Used by {name}".into());
        }
    }
}
