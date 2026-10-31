// Runs at the start of every frame (hook point `frame`): says hello once, in the log.
fn {id}_frame(game: &mut crate::game::Game<'_>) {
    use std::sync::atomic::{AtomicBool, Ordering};
    static DONE: AtomicBool = AtomicBool::new(false);
    if DONE.swap(true, Ordering::Relaxed) {
        return;
    }
    let _ = game;
    eprintln!("{id}: hello from a mixin mod");
}
