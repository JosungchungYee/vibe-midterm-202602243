(() => {
  const storageKey = "ongi-cafe-state-v1";
  const historyKey = "ongi-cafe";
  const menu = [
    { id: "americano", name: "아메리카노", price: 4000, temperatureRequired: true },
    { id: "latte", name: "라떼", price: 4500, temperatureRequired: true },
    { id: "iced-tea", name: "아이스티", price: 4000, temperatureRequired: false },
    { id: "yogurt-smoothie", name: "요거트 스무디", price: 5000, temperatureRequired: false },
    { id: "mango-smoothie", name: "망고 스무디", price: 5500, temperatureRequired: false },
  ];

  const menuList = document.querySelector("#menu-list");
  const menuView = document.querySelector("#menu-view");
  const optionsView = document.querySelector("#options-view");
  const cartView = document.querySelector("#cart-view");
  const adminView = document.querySelector("#admin-view");
  const optionsMenuName = document.querySelector("#options-menu-name");
  const temperatureGroup = document.querySelector("#temperature-group");
  const shotOption = document.querySelector("#shot-option");
  const syrupOption = document.querySelector("#syrup-option");
  const optionsTotal = document.querySelector("#options-total");
  const addToCartButton = document.querySelector("#add-to-cart-button");
  const cartCount = document.querySelector("#cart-count");
  const cartList = document.querySelector("#cart-list");
  const cartTotal = document.querySelector("#cart-total");
  const cartFeedback = document.querySelector("#cart-feedback");
  const orderButton = document.querySelector("#order-button");
  const ordersList = document.querySelector("#orders-list");
  const inventoryList = document.querySelector("#inventory-list");
  const ordersPanel = document.querySelector("#orders-panel");
  const inventoryPanel = document.querySelector("#inventory-panel");
  const pageNavButtons = document.querySelectorAll("[data-view]");
  const adminTabButtons = document.querySelectorAll("[data-admin-tab]");
  const appError = document.querySelector("#app-error");
  let storageReady = true;
  let activeDrink = null;
  let draftOptions = null;
  let currentScreen = "menu";
  let migratedLegacyState = false;

  function reportStorageError(message, error) {
    console.error(message, error);
    appError.textContent = "저장된 장바구니, 재고 또는 주문을 불러오거나 저장하지 못했습니다. 브라우저 저장소 설정을 확인해 주세요. 현재 화면에서는 변경 사항이 이 기기에서 유지되지 않을 수 있습니다.";
    appError.hidden = false;
    storageReady = false;
  }

  function formatPrice(price) {
    return `${price.toLocaleString("ko-KR")}원`;
  }

  function getUnitPrice(drink, options) {
    return drink.price + (options.extraShot ? 500 : 0);
  }

  function isValidCartItem(item, allowUnspecifiedTemperature = false) {
    if (!item || typeof item !== "object" || !Number.isSafeInteger(item.quantity)
      || item.quantity < 1 || !item.options || typeof item.options !== "object") {
      return false;
    }

    const drink = menu.find((entry) => entry.id === item.drinkId);
    if (!drink || item.name !== drink.name || item.basePrice !== drink.price
      || typeof item.options.extraShot !== "boolean"
      || typeof item.options.syrup !== "boolean") {
      return false;
    }

    const temperature = item.options.temperature;
    if (drink.temperatureRequired
      ? !(["ice", "hot"].includes(temperature)
        || (allowUnspecifiedTemperature && temperature === null))
      : temperature !== null) {
      return false;
    }

    return Number.isSafeInteger(item.unitPrice)
      && item.unitPrice === getUnitPrice(drink, item.options);
  }

  function isValidOrder(order) {
    if (!order || !Number.isSafeInteger(order.orderId)
      || !["preparing", "completed"].includes(order.status)
      || !Array.isArray(order.items) || order.items.length === 0
      || !order.items.every((item) => isValidCartItem(item, true))) {
      return false;
    }

    const total = order.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    return Number.isSafeInteger(order.total) && order.total === total;
  }

  function isValidCurrentState(state) {
    if (!state || typeof state !== "object" || state.version !== 2
      || !state.inventory || typeof state.inventory !== "object"
      || !Array.isArray(state.cart) || !Array.isArray(state.orders)
      || !Number.isSafeInteger(state.nextOrderId)) {
      return false;
    }

    const hasValidInventory = menu.every((drink) => (
      Number.isSafeInteger(state.inventory[drink.id]) && state.inventory[drink.id] >= 0
    ));
    if (!hasValidInventory || !state.cart.every((item) => isValidCartItem(item))
      || !state.orders.every(isValidOrder)) {
      return false;
    }

    const orderIds = new Set(state.orders.map((order) => order.orderId));
    if (orderIds.size !== state.orders.length) return false;
    const highestOrderId = Math.max(0, ...orderIds);
    return state.nextOrderId > highestOrderId;
  }

  function isValidLegacyState(state) {
    if (!state || typeof state !== "object" || state.version !== 1
      || !state.inventory || typeof state.inventory !== "object"
      || !Array.isArray(state.orders) || !Number.isSafeInteger(state.nextOrderId)) {
      return false;
    }

    if (!menu.every((drink) => (
      Number.isSafeInteger(state.inventory[drink.id]) && state.inventory[drink.id] >= 0
    ))) {
      return false;
    }

    const orderIds = new Set();
    const validOrders = state.orders.every((order) => {
      if (!order || !Number.isSafeInteger(order.orderId) || orderIds.has(order.orderId)
        || !["preparing", "completed"].includes(order.status)
        || !Array.isArray(order.items) || order.items.length === 0) {
        return false;
      }

      orderIds.add(order.orderId);
      const itemsValid = order.items.every((item) => {
        if (!item || typeof item !== "object") return false;
        const drink = menu.find((entry) => entry.id === item.drinkId);
        return drink
          && item.name === drink.name
          && typeof item.extraShot === "boolean"
          && ["none", "add"].includes(item.syrup)
          && item.price === drink.price + (item.extraShot ? 500 : 0);
      });
      if (!itemsValid) return false;

      const total = order.items.reduce((sum, item) => sum + item.price, 0);
      return Number.isSafeInteger(order.total) && order.total === total;
    });

    const highestOrderId = Math.max(0, ...orderIds);
    return validOrders && state.nextOrderId > highestOrderId;
  }

  function migrateLegacyState(state) {
    return {
      version: 2,
      inventory: { ...state.inventory },
      cart: [],
      orders: state.orders.map((order) => ({
        ...order,
        items: order.items.map((item) => {
          const drink = menu.find((entry) => entry.id === item.drinkId);
          return {
            drinkId: item.drinkId,
            name: item.name,
            basePrice: drink.price,
            unitPrice: item.price,
            quantity: 1,
            options: {
              temperature: null,
              extraShot: item.extraShot,
              syrup: item.syrup === "add",
            },
          };
        }),
      })),
      nextOrderId: state.nextOrderId,
    };
  }

  function loadSavedState() {
    let rawState;
    try {
      rawState = window.localStorage.getItem(storageKey);
    } catch (error) {
      reportStorageError("Failed to read cafe data from localStorage.", error);
      return null;
    }

    if (rawState === null) return null;

    let state;
    try {
      state = JSON.parse(rawState);
    } catch (error) {
      reportStorageError("Saved cafe data is not valid JSON.", error);
      return null;
    }

    if (state && state.version === 1 && isValidLegacyState(state)) {
      migratedLegacyState = true;
      return migrateLegacyState(state);
    }
    if (isValidCurrentState(state)) return state;

    reportStorageError("Saved cafe data has an invalid structure.", new Error("Invalid saved state."));
    return null;
  }

  const savedState = loadSavedState();
  const inventory = savedState
    ? { ...savedState.inventory }
    : Object.fromEntries(menu.map((drink) => [drink.id, 20]));
  const cart = savedState ? savedState.cart : [];
  const orders = savedState ? savedState.orders : [];
  let nextOrderId = savedState ? savedState.nextOrderId : 1;

  function saveState() {
    if (!storageReady) return;

    const state = {
      version: 2,
      inventory,
      cart,
      orders,
      nextOrderId,
    };

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
    } catch (error) {
      reportStorageError("Failed to save cafe data to localStorage.", error);
    }
  }

  function renderMenu() {
    menuList.innerHTML = menu.map((drink) => {
      const soldOut = inventory[drink.id] === 0;
      return `
        <button class="menu-card${soldOut ? " is-sold-out" : ""}" type="button"
          data-open-options="${drink.id}"${soldOut ? " disabled" : ""}>
          <span class="menu-card-header">
            <span class="menu-card-title">${drink.name}</span>
            <span class="menu-price">${formatPrice(drink.price)}</span>
          </span>
          ${soldOut
            ? '<span class="stock-badge">품절</span>'
            : `<span class="menu-stock">남은 재고 ${inventory[drink.id]}개</span>`}
          <span class="menu-card-hint">${drink.temperatureRequired ? "Ice · Hot 선택 가능" : "메뉴 선택"}</span>
        </button>
      `;
    }).join("");
  }

  function getCartQuantity() {
    return cart.reduce((sum, item) => sum + item.quantity, 0);
  }

  function getCartTotal() {
    return cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  }

  function renderCart() {
    if (cart.length === 0) {
      cartList.innerHTML = '<p class="cart-empty">장바구니가 비어 있습니다.</p>';
    } else {
      cartList.innerHTML = cart.map((item, index) => {
        const optionNames = [
          item.options.temperature === "ice" ? "Ice" : "",
          item.options.temperature === "hot" ? "Hot" : "",
          item.options.extraShot ? "샷 추가" : "",
          item.options.syrup ? "시럽 추가" : "",
        ].filter(Boolean);
        const label = [item.name, ...optionNames].join(" / ");

        return `
          <article class="cart-item">
            <div class="cart-item-details">
              <h3>${label}<span>× ${item.quantity}</span></h3>
              <p class="cart-item-calculation">
                ${formatPrice(item.unitPrice)} × ${item.quantity} = ${formatPrice(item.unitPrice * item.quantity)}
              </p>
            </div>
            <div class="cart-item-actions">
              <span class="cart-item-price">${formatPrice(item.unitPrice * item.quantity)}</span>
              <button class="remove-button" type="button" data-remove-from-cart="${index}">
                삭제
              </button>
            </div>
          </article>
        `;
      }).join("");
    }

    cartTotal.textContent = formatPrice(getCartTotal());
    cartCount.textContent = String(getCartQuantity());
    orderButton.disabled = cart.length === 0;
  }

  function renderOptions() {
    if (!activeDrink || !draftOptions) return;

    optionsMenuName.textContent = activeDrink.name;
    temperatureGroup.hidden = !activeDrink.temperatureRequired;
    document.querySelectorAll('input[name="temperature"]').forEach((input) => {
      input.checked = input.value === draftOptions.temperature;
    });
    shotOption.checked = draftOptions.extraShot;
    syrupOption.checked = draftOptions.syrup;

    const unitPrice = getUnitPrice(activeDrink, draftOptions);
    optionsTotal.textContent = formatPrice(unitPrice);
    addToCartButton.disabled = activeDrink.temperatureRequired && draftOptions.temperature === null;
  }

  function updateDraftOptionStyles() {
    document.querySelectorAll(".choice-card, .large-option").forEach((label) => {
      const input = label.querySelector("input");
      label.classList.toggle("is-selected", input.checked);
    });
  }

  function setScreen(screen) {
    currentScreen = screen;
    menuView.hidden = screen !== "menu";
    optionsView.hidden = screen !== "options";
    cartView.hidden = screen !== "cart";
    adminView.hidden = screen !== "admin";
    pageNavButtons.forEach((button) => {
      const isActive = button.dataset.view === (screen === "admin" ? "admin" : "menu");
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });

    if (screen === "cart") renderCart();
    if (screen === "admin") {
      renderOrders();
      renderInventory();
    }
  }

  function makeHistoryState(screen, drinkId = null) {
    return { app: historyKey, screen, drinkId };
  }

  function routeToMenu({ replace = false } = {}) {
    activeDrink = null;
    draftOptions = null;
    const state = makeHistoryState("menu");
    if (replace) {
      window.history.replaceState(state, "", `${window.location.pathname}${window.location.search}`);
    } else {
      window.history.pushState(state, "", `${window.location.pathname}${window.location.search}`);
    }
    setScreen("menu");
  }

  function openOptions(drinkId) {
    if (currentScreen !== "menu") return;
    const drink = menu.find((item) => item.id === drinkId);
    if (!drink || inventory[drink.id] === 0) return;

    activeDrink = drink;
    draftOptions = { temperature: null, extraShot: false, syrup: false };
    window.history.pushState(
      makeHistoryState("options", drink.id),
      "",
      `${window.location.pathname}${window.location.search}#options-${drink.id}`,
    );
    renderOptions();
    updateDraftOptionStyles();
    setScreen("options");
  }

  function handleHistoryChange(event) {
    const state = event.state;
    if (!state || state.app !== historyKey) {
      activeDrink = null;
      draftOptions = null;
      window.history.replaceState(makeHistoryState("menu"), "", `${window.location.pathname}${window.location.search}`);
      setScreen("menu");
      return;
    }

    if (state.screen === "options") {
      const drink = menu.find((item) => item.id === state.drinkId);
      if (!drink || inventory[drink.id] === 0) {
        routeToMenu({ replace: true });
        return;
      }
      activeDrink = drink;
      draftOptions = { temperature: null, extraShot: false, syrup: false };
      renderOptions();
      updateDraftOptionStyles();
      setScreen("options");
      return;
    }

    activeDrink = null;
    draftOptions = null;
    if (state.screen === "menu" || state.screen === "cart") {
      setScreen(state.screen);
      return;
    }
    routeToMenu({ replace: true });
  }

  function addDraftToCart() {
    if (!activeDrink || !draftOptions
      || (activeDrink.temperatureRequired && draftOptions.temperature === null)) {
      return;
    }

    const existingItem = cart.find((item) => (
      item.drinkId === activeDrink.id
      && item.options.temperature === draftOptions.temperature
      && item.options.extraShot === draftOptions.extraShot
      && item.options.syrup === draftOptions.syrup
    ));
    if (existingItem) {
      existingItem.quantity += 1;
    } else {
      cart.push({
        drinkId: activeDrink.id,
        name: activeDrink.name,
        basePrice: activeDrink.price,
        unitPrice: getUnitPrice(activeDrink, draftOptions),
        quantity: 1,
        options: { ...draftOptions },
      });
    }

    saveState();
    renderCart();
    activeDrink = null;
    draftOptions = null;
    window.history.back();
  }

  function placeOrder() {
    if (cart.length === 0) return;

    const quantities = new Map();
    cart.forEach((item) => {
      quantities.set(item.drinkId, (quantities.get(item.drinkId) || 0) + item.quantity);
    });

    const unavailable = menu.find((drink) => (
      (quantities.get(drink.id) || 0) > inventory[drink.id]
    ));
    if (unavailable) {
      cartFeedback.textContent = `${unavailable.name} 재고가 부족하여 주문할 수 없습니다.`;
      return;
    }

    quantities.forEach((quantity, drinkId) => {
      inventory[drinkId] -= quantity;
    });
    orders.push({
      orderId: nextOrderId++,
      items: cart.map((item) => ({ ...item, options: { ...item.options } })),
      total: getCartTotal(),
      status: "preparing",
    });

    const itemCount = getCartQuantity();
    cart.length = 0;
    saveState();
    renderMenu();
    renderCart();
    cartFeedback.textContent = `${itemCount}개 메뉴 주문이 접수되었습니다.`;
  }

  function renderOrders() {
    if (orders.length === 0) {
      ordersList.innerHTML = '<p class="cart-empty">접수된 주문이 없습니다.</p>';
      return;
    }

    ordersList.innerHTML = `<div class="orders-list">${orders.map((order) => {
      const items = order.items.map((item) => {
        const optionNames = [
          item.options.temperature === "ice" ? "Ice" : "",
          item.options.temperature === "hot" ? "Hot" : "",
          item.options.extraShot ? "샷 추가" : "",
          item.options.syrup ? "시럽 추가" : "",
        ].filter(Boolean);
        const label = [item.name, ...optionNames].join(" / ");

        return `
          <li>
            <span>${label} × ${item.quantity}</span>
            <strong>${formatPrice(item.unitPrice * item.quantity)}</strong>
          </li>
        `;
      }).join("");
      const isComplete = order.status === "completed";

      return `
        <article class="order-card">
          <div class="order-card-header">
            <h3>주문 ${order.orderId}</h3>
            <span class="order-status">${isComplete ? "제조 완료" : "제조 중"}</span>
          </div>
          <ul class="order-items">${items}</ul>
          <div class="order-card-footer">
            <strong>합계 ${formatPrice(order.total)}</strong>
            ${isComplete
              ? '<span class="order-status">처리 완료</span>'
              : `<button class="button" type="button" data-complete-order="${order.orderId}">제조 완료</button>`}
          </div>
        </article>
      `;
    }).join("")}</div>`;
  }

  function renderInventory() {
    inventoryList.innerHTML = menu.map((drink) => {
      const stock = inventory[drink.id];
      return `
        <article class="inventory-card">
          <h3>${drink.name}</h3>
          <p>${stock === 0 ? "품절" : `남은 재고 ${stock}개`}</p>
        </article>
      `;
    }).join("");
  }

  function setAdminTab(tab) {
    const showOrders = tab === "orders";
    ordersPanel.hidden = !showOrders;
    inventoryPanel.hidden = showOrders;
    adminTabButtons.forEach((button) => {
      const isActive = button.dataset.adminTab === tab;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", String(isActive));
    });
  }

  menuList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-open-options]");
    if (button) openOptions(button.dataset.openOptions);
  });

  optionsView.addEventListener("change", (event) => {
    if (!activeDrink || !draftOptions) return;
    if (event.target.name === "temperature") {
      draftOptions.temperature = event.target.value;
    } else if (event.target === shotOption) {
      draftOptions.extraShot = shotOption.checked;
    } else if (event.target === syrupOption) {
      draftOptions.syrup = syrupOption.checked;
    } else {
      return;
    }
    renderOptions();
    updateDraftOptionStyles();
  });

  document.querySelector("#options-back-button").addEventListener("click", () => {
    if (currentScreen === "options") window.history.back();
  });

  document.querySelector("#add-to-cart-button").addEventListener("click", addDraftToCart);

  document.querySelector("#open-cart-button").addEventListener("click", () => {
    if (currentScreen !== "menu") return;
    window.history.pushState(makeHistoryState("cart"), "", `${window.location.pathname}${window.location.search}#cart`);
    setScreen("cart");
  });

  document.querySelector("#cart-back-button").addEventListener("click", () => {
    if (currentScreen === "cart") window.history.back();
  });

  pageNavButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.view;
      if (view === "menu") {
        if (currentScreen === "options" || currentScreen === "cart") {
          window.history.back();
        } else {
          routeToMenu();
        }
        return;
      }

      activeDrink = null;
      draftOptions = null;
      if (currentScreen === "options") {
        window.history.replaceState(
          makeHistoryState("menu"),
          "",
          `${window.location.pathname}${window.location.search}`,
        );
      }
      window.history.pushState(makeHistoryState("admin"), "", `${window.location.pathname}${window.location.search}#admin`);
      setScreen("admin");
    });
  });

  adminTabButtons.forEach((button) => {
    button.addEventListener("click", () => setAdminTab(button.dataset.adminTab));
  });

  ordersList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-complete-order]");
    if (!button) return;

    const orderId = Number(button.dataset.completeOrder);
    const order = orders.find((item) => item.orderId === orderId);
    if (!order || order.status === "completed") return;

    order.status = "completed";
    saveState();
    renderOrders();
  });

  document.querySelector("#order-button").addEventListener("click", placeOrder);
  window.addEventListener("popstate", handleHistoryChange);

  renderMenu();
  renderCart();
  setAdminTab("orders");
  const initialState = makeHistoryState("menu");
  window.history.replaceState(initialState, "", `${window.location.pathname}${window.location.search}`);
  setScreen("menu");
  if (migratedLegacyState) saveState();
  if (!savedState && storageReady) saveState();
})();
