// A performance in 3D, whatever set it's on (ADR 18): a thin dispatcher
// over the set's own view (public/sets/<id>-view.js), rebuilt when the
// performance moves to another set. It only draws; the scene (scene.js)
// handles touch through the view's aim/press, and the page sends gestures.
import * as THREE from "three";
import { viewOf } from "./sets/views.js";

/**
 * A performance on a holder group. `update(p, t, opts)` plays `p` (on any
 * set) to loop moment `t` and returns what happened since the last call;
 * `set()` names the set it's drawing, and `view()` is that set's own view
 * (objects, aim, haloOf, press, marks). `small` builds it with fewer
 * facets, for a plinth.
 */
export function createStageView({ small = false } = {}) {
  const root = new THREE.Group();
  let set = "";
  /** @type {any} */
  let view = null;
  const onBuild = [];
  function build(id) {
    if (view) {
      root.remove(view.root);
      view.dispose();
    }
    set = id;
    view = viewOf(id).createView(THREE, { small });
    root.add(view.root);
    for (const f of onBuild) f(view.root);
  }
  return {
    root,
    update(p, t, opts) {
      if (p.set !== set) build(p.set);
      return view.update(p, t, opts);
    },
    set: () => set,
    view: () => view,
    objects: () => (view ? view.objects() : {}),
    /** run `f(root)` on every view root built, now and later */
    each(f) {
      onBuild.push(f);
      if (view) f(view.root);
    },
    dispose: () => view?.dispose(),
    busy: () => !!view && view.busy(),
    moving: () => !!view && view.moving(),
  };
}
