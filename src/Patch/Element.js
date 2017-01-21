import Native from './Native';
import CustomElementInternals from '../CustomElementInternals';
import CEState from '../CustomElementState';
import * as Utilities from '../Utilities';

import PatchParentNode from './Interface/ParentNode';
import PatchChildNode from './Interface/ChildNode';

/**
 * @param {!CustomElementInternals} internals
 */
export default function(internals) {
  if (Native.Element_attachShadow) {
    Utilities.setPropertyUnchecked(Element.prototype, 'attachShadow',
      /**
       * @this {Element}
       * @param {!{mode: string}} init
       * @return {ShadowRoot}
       */
      function(init) {
        const shadowRoot = Native.Element_attachShadow.call(this, init);
        this.__CE_shadowRoot = shadowRoot;
        return shadowRoot;
      });
  } else {
    console.warn('Custom Elements: `Element#attachShadow` was not patched.');
  }


  // TODO: Patch instances in browsers without an `Element#innerHTML` descriptor (Early Chrome, IE).
  function patch_innerHTML(destination, baseDescriptor) {
    Object.defineProperty(destination, 'innerHTML', {
      enumerable: baseDescriptor.enumerable,
      configurable: true,
      get: baseDescriptor.get,
      set: /** @this {Element} */ function(htmlString) {
        const removedNodes = Array.prototype.slice.apply(this.childNodes);

        baseDescriptor.set.call(this, htmlString);

        if (Utilities.isConnected(this)) {
          for (let i = 0; i < removedNodes.length; i++) {
            internals.disconnectTree(removedNodes[i]);
          }
        }

        internals.patchTree(this);
        // Only create custom elements if this element's owner document is
        // associated with the registry.
        if (this.ownerDocument.__CE_hasRegistry) {
          internals.upgradeTree(this);
        }
        return htmlString;
      },
    });
  }

  if (Native.Element_innerHTML && Native.Element_innerHTML.get) {
    patch_innerHTML(Element.prototype, Native.Element_innerHTML);
  } else if (Native.HTMLElement_innerHTML && Native.HTMLElement_innerHTML.get) {
    patch_innerHTML(HTMLElement.prototype, Native.HTMLElement_innerHTML);
  } else {
    // Assume that `innerHTML` is implemented as a 'magic' data descriptor on
    // all instances.

    /** @type {HTMLDivElement} */
    const rawDiv = Native.Document_createElement.call(document, 'div');

    internals.addPatch(function(element) {
      patch_innerHTML(element, {
        enumerable: true,
        configurable: true,
        get: /** @this {Element} */ function() {
          // TODO: Is this too expensive?
          return Native.Node_cloneNode.call(this, true).innerHTML;
        },
        set: /** @this {Element} */ function(assignedValue) {
          rawDiv.innerHTML = assignedValue;

          while (this.childNodes.length > 0) {
            Native.Node_removeChild.call(this, this.childNodes[0]);
          }
          while (rawDiv.childNodes.length > 0) {
            Native.Node_appendChild.call(this, rawDiv.childNodes[0]);
          }
        },
      });
    });
  }


  Utilities.setPropertyUnchecked(Element.prototype, 'setAttribute',
    /**
     * @this {Element}
     * @param {string} name
     * @param {string} newValue
     */
    function(name, newValue) {
      // Fast path for non-custom elements.
      if (this.__CE_state !== CEState.custom) {
        return Native.Element_setAttribute.call(this, name, newValue);
      }

      const oldValue = Native.Element_getAttribute.call(this, name);
      Native.Element_setAttribute.call(this, name, newValue);
      newValue = Native.Element_getAttribute.call(this, name);
      if (oldValue !== newValue) {
        internals.attributeChangedCallback(this, name, oldValue, newValue, null);
      }
    });

  Utilities.setPropertyUnchecked(Element.prototype, 'setAttributeNS',
    /**
     * @this {Element}
     * @param {?string} namespace
     * @param {string} name
     * @param {string} newValue
     */
    function(namespace, name, newValue) {
      // Fast path for non-custom elements.
      if (this.__CE_state !== CEState.custom) {
        return Native.Element_setAttributeNS.call(this, namespace, name, newValue);
      }

      const oldValue = Native.Element_getAttributeNS.call(this, namespace, name);
      Native.Element_setAttributeNS.call(this, namespace, name, newValue);
      newValue = Native.Element_getAttributeNS.call(this, namespace, name);
      if (oldValue !== newValue) {
        internals.attributeChangedCallback(this, name, oldValue, newValue, namespace);
      }
    });

  Utilities.setPropertyUnchecked(Element.prototype, 'removeAttribute',
    /**
     * @this {Element}
     * @param {string} name
     */
    function(name) {
      // Fast path for non-custom elements.
      if (this.__CE_state !== CEState.custom) {
        return Native.Element_removeAttribute.call(this, name);
      }

      const oldValue = Native.Element_getAttribute.call(this, name);
      Native.Element_removeAttribute.call(this, name);
      if (oldValue !== null) {
        internals.attributeChangedCallback(this, name, oldValue, null, null);
      }
    });

  Utilities.setPropertyUnchecked(Element.prototype, 'remoteAttributeNS',
    /**
     * @this {Element}
     * @param {?string} namespace
     * @param {string} name
     */
    function(namespace, name) {
      // Fast path for non-custom elements.
      if (this.__CE_state !== CEState.custom) {
        return Native.Element_removeAttributeNS.call(this, namespace, name);
      }

      const oldValue = Native.Element_getAttributeNS.call(this, namespace, name);
      Native.Element_removeAttributeNS.call(this, namespace, name);
      if (oldValue !== null) {
        internals.attributeChangedCallback(this, name, oldValue, null, namespace);
      }
    });

  Utilities.setPropertyUnchecked(Element.prototype, 'insertAdjacentElement',
    /**
     * @this {Element}
     * @param {string} where
     * @param {!Element} element
     * @return {?Element}
     */
    function(where, element) {
      const wasConnected = Utilities.isConnected(element);
      const insertedElement = /** @type {!Element} */
        (Native.Element_insertAdjacentElement.call(this, where, element));

      if (wasConnected) {
        internals.disconnectTree(element);
      }

      if (Utilities.isConnected(insertedElement)) {
        internals.connectTree(element);
      }
      return insertedElement;
    });

  PatchParentNode(internals, Element.prototype, {
    prepend: Native.Element_prepend,
    append: Native.Element_append,
  });

  PatchChildNode(internals, Element.prototype, {
    before: Native.Element_before,
    after: Native.Element_after,
    replaceWith: Native.Element_replaceWith,
    remove: Native.Element_remove,
  });
};
