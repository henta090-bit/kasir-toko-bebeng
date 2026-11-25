/**
 * TOKO BEBENG - KASIR MOBILE PWA
 * Frontend Engine: Presisi Thermal 80mm & Dashboard Laporan Penjualan
 */

// ==========================================
// 1. KONFIGURASI TURSO DATABASE & STORAGE
// ==========================================
const TURSO_CONFIG = {
  url: "https://toko-bebeng-henta090.aws-ap-southeast-1.turso.io/v2/pipeline",
  token: "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTQ5MDM0NTksImlkIjoiMDFhMWU4OTItZjAwMS03OTU1LTk5N2MtODhmZDk4ODJlYzZjIiwia2lkIjoiY2ZSMW5nOWkzRUpZWnR0bjg2UkRmRWhHS1hNWDNET2ZkVG1rd3BsLUNFOCIsInJpZCI6IjQyODVhNjRiLWZlOGMtNDY2NS05MGQ0LTRmMjIyNzhkYzdmZiJ9.tCc35tO5lAfHMhqhHb2MjCSAzPaun4U2ch-OF46v5ypdAuQOGggSGcRznrHYsQuuG-3bPvaaIgVjhcHJzdnSBw"
};

const STORAGE_KEYS = {
  PRODUCTS: 'bebeng_products_cache',
  CUSTOMERS: 'bebeng_customers_cache',
  OFFLINE_QUEUE: 'bebeng_offline_queue',
  HISTORY: 'bebeng_tx_history',
  CONFIG: 'bebeng_printer_config',
  USERS: 'bebeng_users_cache',
  ACTIVE_USER: 'bebeng_active_user'
};

// Default Konfigurasi Toko & Printer (Lebar 80mm)
let storeConfig = {
  paper_width: 80,
  store_name: "TOKO BEBENG",
  store_address: "Jl. Kosambi No. 8, Bandung",
  store_phone: "08123456789",
  store_footer: "Terima Kasih Atas Kunjungan Anda\nBarang yang sudah dibeli\ntidak dapat ditukar/dikembalikan"
};

// State Aplikasi
let state = {
  products: [],
  customers: [],
  users: [],
  currentUser: null,
  cart: [],
  isOnline: navigator.onLine,
  isScanning: false,
  scannerInstance: null,
  activeTransaction: null,
  reportPeriod: 'today',
  scannerMode: 'cart' // 'cart' | 'scanToEdit' | 'fillBarcode'
};

// ==========================================
// 2. WEB AUDIO & HAPTIC FEEDBACK (BEEP SOUND)
// ==========================================
function playBeep(freq = 880, duration = 0.08) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + duration);
    osc.stop(ctx.currentTime + duration);
  } catch (e) {}

  if (navigator.vibrate) {
    try { navigator.vibrate(60); } catch (e) {}
  }
}

function showToast(message, duration = 2500) {
  const toast = document.getElementById('toast');
  toast.innerText = message;
  toast.classList.add('show');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

function formatRupiah(number) {
  return 'Rp ' + Number(number || 0).toLocaleString('id-ID');
}

function formatAngka(number) {
  return Number(number || 0).toLocaleString('id-ID');
}

// ==========================================
// 3. TURSO HTTP API CLIENT
// ==========================================
async function queryTurso(sql, args = []) {
  const typedArgs = args.map(arg => {
    if (arg === null || arg === undefined) return { type: "null" };
    if (typeof arg === "number") {
      return Number.isInteger(arg) ? { type: "integer", value: String(arg) } : { type: "float", value: arg };
    }
    if (typeof arg === "boolean") return { type: "integer", value: arg ? "1" : "0" };
    return { type: "text", value: String(arg) };
  });

  const payload = {
    requests: [
      { type: "execute", stmt: { sql, args: typedArgs } },
      { type: "close" }
    ]
  };

  const response = await fetch(TURSO_CONFIG.url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TURSO_CONFIG.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`HTTP Error ${response.status}`);
  }

  const data = await response.json();
  const res0 = data.results[0];
  if (res0.type === "error") {
    throw new Error(res0.error.message);
  }

  const cols = res0.response.result.cols.map(c => c.name);
  const rows = res0.response.result.rows.map(row => {
    const obj = {};
    row.forEach((cell, idx) => {
      obj[cols[idx]] = cell.value;
    });
    return obj;
  });

  return rows;
}

// ==========================================
// 4. DATA LOADER & OFFLINE CACHE
// ==========================================
function loadCachedData() {
  const savedCfg = localStorage.getItem(STORAGE_KEYS.CONFIG);
  if (savedCfg) {
    try {
      storeConfig = Object.assign(storeConfig, JSON.parse(savedCfg));
      document.getElementById('headerStoreName').innerText = storeConfig.store_name;
    } catch (e) {}
  }

  const cachedProducts = localStorage.getItem(STORAGE_KEYS.PRODUCTS);
  if (cachedProducts) {
    try {
      state.products = JSON.parse(cachedProducts);
      updateProductCountDisplay();
    } catch (e) {}
  }

  const cachedCust = localStorage.getItem(STORAGE_KEYS.CUSTOMERS);
  if (cachedCust) {
    try {
      state.customers = JSON.parse(cachedCust);
      renderCustomerOptions();
    } catch (e) {}
  }

  const cachedUsers = localStorage.getItem(STORAGE_KEYS.USERS);
  if (cachedUsers) {
    try {
      state.users = JSON.parse(cachedUsers);
    } catch (e) {}
  }
  if (!state.users || state.users.length === 0) {
    state.users = [
      { username: 'admin', name: 'Owner / Admin', pin: '1234', role: 'admin' },
      { username: 'kasir1', name: 'Kasir 1', pin: '1111', role: 'kasir' }
    ];
  }
  renderLoginUserOptions();

  const savedActiveUser = localStorage.getItem(STORAGE_KEYS.ACTIVE_USER);
  if (savedActiveUser) {
    try {
      state.currentUser = JSON.parse(savedActiveUser);
    } catch (e) {}
  }

  applyUserRolePermissions();
  checkOfflineQueue();
}

function updateProductCountDisplay() {
  const countEl = document.getElementById('productCountText');
  if (countEl) {
    countEl.innerText = `${state.products.length} Produk`;
  }
}

async function syncWithTurso(showNotice = false) {
  const btnSync = document.getElementById('btnSync');
  btnSync.style.transform = 'rotate(360deg)';
  btnSync.style.transition = 'transform 0.6s ease';

  if (showNotice) showToast("Mengambil data terbaru dari Turso...");

  try {
    const products = await queryTurso(
      "SELECT sku, barcode_slop, name, purchase_price, selling_price, wholesale_price, category FROM products WHERE is_active = 1 ORDER BY name ASC"
    );
    if (products && products.length > 0) {
      state.products = products.map(p => ({
        sku: p.sku,
        barcode: p.barcode_slop || "",
        name: p.name,
        price: parseFloat(p.selling_price) || 0,
        purchase_price: parseFloat(p.purchase_price) || 0,
        wholesale_price: parseFloat(p.wholesale_price) || 0,
        category: p.category || ""
      }));
      localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(state.products));
      updateProductCountDisplay();
    }

    const customers = await queryTurso(
      "SELECT customer_code, name, address, phone FROM pos_customers ORDER BY name ASC"
    );
    if (customers && customers.length > 0) {
      state.customers = customers;
      localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify(state.customers));
      renderCustomerOptions();
    }

    try {
      const users = await queryTurso(
        "SELECT username, name, pin, role FROM pos_users WHERE is_active = 1 ORDER BY role DESC, name ASC"
      );
      if (users && users.length > 0) {
        state.users = users;
        localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(state.users));
        renderLoginUserOptions();
        if (state.currentUser) {
          const fresh = state.users.find(u => u.username === state.currentUser.username);
          if (fresh) {
            state.currentUser = fresh;
            localStorage.setItem(STORAGE_KEYS.ACTIVE_USER, JSON.stringify(fresh));
            applyUserRolePermissions();
          }
        }
      }
    } catch (eu) {
      console.warn("User sync skipped:", eu);
    }

    await flushOfflineQueue();

    setOnlineStatus(true);
    if (showNotice) showToast("✅ Data berhasil disinkronkan dengan Cloud!");
  } catch (err) {
    console.warn("Koneksi Turso gagal, gunakan cache:", err);
    setOnlineStatus(false);
    if (showNotice) showToast("⚠️ Gagal koneksi cloud. Menggunakan data memori HP.");
  } finally {
    setTimeout(() => {
      btnSync.style.transform = 'none';
      btnSync.style.transition = 'none';
    }, 600);
  }
}

function setOnlineStatus(isOnline) {
  state.isOnline = isOnline;
  const badge = document.getElementById('statusBadge');
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  const banner = document.getElementById('offlineBanner');

  if (isOnline) {
    badge.className = 'status-badge online';
    text.innerText = 'Online';
    banner.style.display = 'none';
  } else {
    badge.className = 'status-badge offline';
    text.innerText = 'Offline';
    banner.style.display = 'block';
  }
}

function renderCustomerOptions() {
  const select = document.getElementById('customerSelect');
  select.innerHTML = '<option value="UMUM">UMUM (Pelanggan Biasa)</option>';
  state.customers.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.customer_code;
    opt.textContent = `${c.name} (${c.customer_code})`;
    select.appendChild(opt);
  });
}

// ==========================================
// 5. KERANJANG BELANJA (CART)
// ==========================================
function addToCart(product, qty = 1) {
  const existing = state.cart.find(item => item.sku === product.sku);
  if (existing) {
    existing.qty += qty;
    existing.subtotal = existing.qty * existing.price;
  } else {
    state.cart.push({
      sku: product.sku,
      barcode: product.barcode,
      name: product.name,
      price: product.price,
      qty: qty,
      subtotal: product.price * qty
    });
  }

  playBeep();
  renderCart();
  showToast(`+ ${product.name}`);

  // Scroll otomatis ke item yang baru ditambahkan/diubah di keranjang
  setTimeout(() => {
    const el = document.querySelector(`.cart-item[data-sku="${product.sku}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, 60);
}

function updateCartQty(sku, newQty) {
  const item = state.cart.find(i => i.sku === sku);
  if (!item) return;

  newQty = parseInt(newQty) || 0;
  if (newQty <= 0) {
    removeFromCart(sku);
    return;
  }

  item.qty = newQty;
  item.subtotal = item.qty * item.price;
  renderCart();
}

function removeFromCart(sku) {
  state.cart = state.cart.filter(item => item.sku !== sku);
  renderCart();
}

function clearCart() {
  if (state.cart.length === 0) return;
  if (confirm("Kosongkan keranjang belanja?")) {
    state.cart = [];
    renderCart();
  }
}

function renderCart() {
  const container = document.getElementById('cartContainer');
  const clearBtn = document.getElementById('btnClearCart');
  const totalItemsLbl = document.getElementById('totalItemsLabel');
  const totalPriceLbl = document.getElementById('totalPriceLabel');
  const btnCheckout = document.getElementById('btnCheckout');

  if (state.cart.length === 0) {
    container.innerHTML = `
      <div class="cart-empty">
        <div class="cart-empty-icon">🛒</div>
        <div class="cart-empty-title">Keranjang Kosong</div>
        <div class="cart-empty-desc">Ketik nama barang di atas atau scan barcode produk untuk mulai transaksi.</div>
      </div>
    `;
    clearBtn.style.display = 'none';
    totalItemsLbl.innerText = '0 Item';
    totalPriceLbl.innerText = 'Rp 0';
    btnCheckout.disabled = true;
    return;
  }

  clearBtn.style.display = 'block';
  btnCheckout.disabled = false;

  let totalQty = 0;
  let grandTotal = 0;

  const isAdmin = state.currentUser && state.currentUser.role === 'admin';
  let html = '';
  state.cart.forEach(item => {
    totalQty += item.qty;
    grandTotal += item.subtotal;

    html += `
      <div class="cart-item" data-sku="${item.sku}">
        <div class="item-top">
          <div class="item-title">${escapeHtml(item.name)}</div>
          <button class="item-btn-remove" onclick="removeFromCart('${item.sku}')" title="Hapus">✕</button>
        </div>
        <div class="item-bottom">
          ${isAdmin ? `
            <div class="item-unit-price editable-price" onclick="openPriceOverrideModal('${item.sku}', true)" title="Klik untuk atur harga khusus lebaran">
              <span>${formatRupiah(item.price)}</span> <span class="badge-edit-pencil">✏️</span>
            </div>
          ` : `
            <div class="item-unit-price">${formatRupiah(item.price)}</div>
          `}
          <div class="qty-control">
            <button class="qty-btn" onclick="updateCartQty('${item.sku}', ${item.qty - 1})">-</button>
            <input type="number" class="qty-input" value="${item.qty}" min="1" 
                   onchange="updateCartQty('${item.sku}', this.value)" 
                   onclick="this.select()">
            <button class="qty-btn" onclick="updateCartQty('${item.sku}', ${item.qty + 1})">+</button>
          </div>
          <div class="item-subtotal">${formatRupiah(item.subtotal)}</div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
  totalItemsLbl.innerText = `${totalQty} Item (${state.cart.length} Produk)`;
  totalPriceLbl.innerText = formatRupiah(grandTotal);
}

// ==========================================
// 6. INSTANT SEARCH & SCANNER
// ==========================================
const searchInput = document.getElementById('searchInput');
const clearSearchBtn = document.getElementById('btnClearSearch');
const suggestionsList = document.getElementById('suggestionsList');

searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim().toLowerCase();
  if (!query) {
    suggestionsList.style.display = 'none';
    clearSearchBtn.style.display = 'none';
    return;
  }

  clearSearchBtn.style.display = 'block';

  const matched = state.products.filter(p => {
    return p.name.toLowerCase().includes(query) ||
           (p.barcode && p.barcode.toLowerCase().includes(query)) ||
           p.sku.toLowerCase().includes(query);
  }).slice(0, 15);

  if (matched.length === 0) {
    suggestionsList.innerHTML = `<div style="padding: 14px; text-align: center; color: var(--text-muted); font-size: 13px;">Barang '${escapeHtml(query)}' tidak ditemukan.</div>`;
    suggestionsList.style.display = 'block';
    return;
  }

  const isAdmin = state.currentUser && state.currentUser.role === 'admin';
  let html = '';
  matched.forEach(p => {
    html += `
      <div class="suggestion-item" data-sku="${p.sku}">
        <div style="flex: 1; min-width: 0;">
          <div class="sugg-name">${escapeHtml(p.name)}</div>
          <div class="sugg-meta">${p.barcode ? 'Barcode: ' + p.barcode : 'SKU: ' + p.sku}</div>
        </div>
        <div class="sugg-right">
          <div class="sugg-price">${formatRupiah(p.price)}</div>
          ${isAdmin ? `<button type="button" class="btn-sugg-custom-price" data-sku="${p.sku}" title="Ubah harga sebelum masuk keranjang">✏️ Atur Harga</button>` : ''}
        </div>
      </div>
    `;
  });

  suggestionsList.innerHTML = html;
  suggestionsList.style.display = 'block';
});

suggestionsList.addEventListener('click', (e) => {
  const btnCustom = e.target.closest('.btn-sugg-custom-price');
  if (btnCustom) {
    e.stopPropagation();
    const sku = btnCustom.getAttribute('data-sku');
    openPriceOverrideModal(sku, false);
    searchInput.value = '';
    suggestionsList.style.display = 'none';
    clearSearchBtn.style.display = 'none';
    return;
  }

  const itemEl = e.target.closest('.suggestion-item');
  if (!itemEl) return;
  const sku = itemEl.getAttribute('data-sku');
  const product = state.products.find(p => p.sku === sku);
  if (product) {
    addToCart(product);
    searchInput.value = '';
    suggestionsList.style.display = 'none';
    clearSearchBtn.style.display = 'none';
  }
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const query = searchInput.value.trim().toLowerCase();
    if (!query) return;

    const exact = state.products.find(p => 
      (p.barcode && p.barcode.toLowerCase() === query) || p.sku.toLowerCase() === query
    );
    if (exact) {
      addToCart(exact);
      searchInput.value = '';
      suggestionsList.style.display = 'none';
      clearSearchBtn.style.display = 'none';
      return;
    }

    const firstItem = suggestionsList.querySelector('.suggestion-item');
    if (firstItem) {
      const sku = firstItem.getAttribute('data-sku');
      const product = state.products.find(p => p.sku === sku);
      if (product) {
        addToCart(product);
        searchInput.value = '';
        suggestionsList.style.display = 'none';
        clearSearchBtn.style.display = 'none';
      }
    }
  }
});

clearSearchBtn.addEventListener('click', () => {
  searchInput.value = '';
  suggestionsList.style.display = 'none';
  clearSearchBtn.style.display = 'none';
  searchInput.focus();
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-container')) {
    suggestionsList.style.display = 'none';
  }
});

// ==========================================
// 7. KAMERA BARCODE SCANNER
// ==========================================
const btnOpenScanner = document.getElementById('btnOpenScanner');
const scannerModal = document.getElementById('scannerModal');
const btnCloseScanner = document.getElementById('btnCloseScanner');
const manualBarcodeInput = document.getElementById('manualBarcodeInput');
const btnManualBarcodeSubmit = document.getElementById('btnManualBarcodeSubmit');

btnOpenScanner.addEventListener('click', () => {
  state.scannerMode = 'cart';
  scannerModal.classList.add('active');
  startScanner();
});

btnCloseScanner.addEventListener('click', () => {
  stopScanner();
  scannerModal.classList.remove('active');
});

function startScanner() {
  if (state.isScanning) return;
  state.isScanning = true;

  try {
    state.scannerInstance = new Html5Qrcode("reader");
    const config = {
      fps: 15,
      qrbox: { width: 260, height: 160 },
      aspectRatio: 1.333334
    };

    state.scannerInstance.start(
      { facingMode: "environment" },
      config,
      (decodedText) => {
        handleBarcodeScanned(decodedText);
      },
      (error) => {}
    ).catch(err => {
      console.warn("Kamera gagal diakses:", err);
      document.getElementById('reader').innerHTML = `
        <div style="padding: 24px; text-align: center; color: var(--accent-amber); font-size: 13px;">
          📷 Kamera tidak dapat diakses langsung (butuh izin kamera/HTTPS).<br>
          Silakan gunakan input barcode manual di bawah ini:
        </div>
      `;
    });
  } catch (err) {
    console.error("Gagal inisialisasi scanner:", err);
  }
}

function stopScanner() {
  if (state.scannerInstance && state.isScanning) {
    state.scannerInstance.stop().then(() => {
      state.scannerInstance.clear();
      state.isScanning = false;
    }).catch(err => {
      state.isScanning = false;
    });
  }
}

function handleBarcodeScanned(barcode) {
  barcode = String(barcode).trim();
  if (!barcode) return;

  if (state.scannerMode === 'scanToEdit') {
    stopScanner();
    scannerModal.classList.remove('active');
    const product = state.products.find(p => 
      (p.barcode && p.barcode.toLowerCase() === barcode.toLowerCase()) || p.sku.toLowerCase() === barcode.toLowerCase()
    );
    if (product) {
      playBeep(880, 0.1);
      openEditProductModal(product.sku);
    } else {
      playBeep(440, 0.2);
      if (confirm(`Barcode '${barcode}' belum terdaftar di database.\nIngin menambahkannya sebagai barang baru sekarang?`)) {
        openNewProductModal(barcode);
      }
    }
    return;
  }

  if (state.scannerMode === 'fillBarcode') {
    stopScanner();
    scannerModal.classList.remove('active');
    const barcodeInput = document.getElementById('formProductBarcode');
    if (barcodeInput) barcodeInput.value = barcode;
    playBeep(880, 0.1);
    showToast(`Barcode ${barcode} terpilih`);
    return;
  }

  // Default: mode belanja (cart)
  const product = state.products.find(p => 
    (p.barcode && p.barcode === barcode) || p.sku === barcode
  );

  if (product) {
    addToCart(product);
    stopScanner();
    scannerModal.classList.remove('active');
  } else {
    playBeep(440, 0.2);
    showToast(`⚠️ Barcode '${barcode}' tidak terdaftar!`);
  }
}

btnManualBarcodeSubmit.addEventListener('click', () => {
  const code = manualBarcodeInput.value.trim();
  if (code) {
    handleBarcodeScanned(code);
    manualBarcodeInput.value = '';
  }
});
manualBarcodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnManualBarcodeSubmit.click();
});

// ==========================================
// 8. CHECKOUT & PEMBAYARAN
// ==========================================
const btnCheckout = document.getElementById('btnCheckout');
const checkoutModal = document.getElementById('checkoutModal');
const btnCloseCheckout = document.getElementById('btnCloseCheckout');
const checkoutTotalVal = document.getElementById('checkoutTotalVal');
const paidInput = document.getElementById('paidInput');
const changeLabel = document.getElementById('changeLabel');
const changeVal = document.getElementById('changeVal');
const btnSubmitOrder = document.getElementById('btnSubmitOrder');

btnCheckout.addEventListener('click', () => {
  if (state.cart.length === 0) return;
  const total = state.cart.reduce((sum, item) => sum + item.subtotal, 0);
  checkoutTotalVal.innerText = formatRupiah(total);
  paidInput.value = '';
  updateChangeDisplay();
  checkoutModal.classList.add('active');
  setTimeout(() => paidInput.focus(), 200);
});

btnCloseCheckout.addEventListener('click', () => {
  checkoutModal.classList.remove('active');
});

paidInput.addEventListener('input', updateChangeDisplay);

document.querySelectorAll('.btn-quick-cash').forEach(btn => {
  btn.addEventListener('click', () => {
    const cashType = btn.getAttribute('data-cash');
    const total = state.cart.reduce((sum, item) => sum + item.subtotal, 0);
    if (cashType === 'pas') {
      paidInput.value = total;
    } else {
      paidInput.value = cashType;
    }
    updateChangeDisplay();
  });
});

function updateChangeDisplay() {
  const total = state.cart.reduce((sum, item) => sum + item.subtotal, 0);
  const paid = parseFloat(paidInput.value) || 0;
  const change = paid - total;

  if (paid === 0) {
    changeLabel.innerText = "Uang Kembalian";
    changeVal.innerText = "Rp 0";
    changeVal.className = "change-val ok";
    btnSubmitOrder.disabled = false;
    return;
  }

  if (change >= 0) {
    changeLabel.innerText = "Uang Kembalian";
    changeVal.innerText = formatRupiah(change);
    changeVal.className = "change-val ok";
    btnSubmitOrder.disabled = false;
  } else {
    changeLabel.innerText = "Kurang Bayar";
    changeVal.innerText = "- " + formatRupiah(Math.abs(change));
    changeVal.className = "change-val less";
    btnSubmitOrder.disabled = true;
  }
}

btnSubmitOrder.addEventListener('click', async () => {
  const total = state.cart.reduce((sum, item) => sum + item.subtotal, 0);
  let paid = parseFloat(paidInput.value);
  if (isNaN(paid) || paid === 0) {
    paid = total;
  }

  if (paid < total) {
    showToast("⚠️ Uang dibayar kurang dari total belanja!");
    paidInput.focus();
    return;
  }

  const change = paid - total;
  const customerCode = document.getElementById('customerSelect').value;
  const now = new Date();
  
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');

  const receiptNumber = `MB-${yyyy}${mm}${dd}-${hh}${min}${ss}`;
  const transactionDate = `${yyyy}-${mm}-${dd}`;
  const transactionTime = `${hh}:${min}:${ss}`;

  const cashierName = state.currentUser ? state.currentUser.name : "Kasir";
  const cashierId = state.currentUser ? state.currentUser.username : "kasir";

  const transactionData = {
    receipt_number: receiptNumber,
    transaction_date: transactionDate,
    transaction_time: transactionTime,
    customer_code: customerCode,
    cashier_id: cashierId,
    cashier_name: cashierName,
    subtotal: total,
    grand_total: total,
    paid: paid,
    change: change,
    items: state.cart.map(item => ({
      sku: item.sku,
      name: item.name,
      qty: item.qty,
      price: item.price,
      subtotal: item.subtotal
    }))
  };

  btnSubmitOrder.disabled = true;
  btnSubmitOrder.innerText = "Menyimpan Transaksi...";

  try {
    await saveTransaction(transactionData);
  } finally {
    btnSubmitOrder.disabled = false;
    btnSubmitOrder.innerText = "SELESAI TRANSAKSI";
    checkoutModal.classList.remove('active');
    
    // Tampilkan Struk Presisi 80mm
    showReceiptModal(transactionData);
    
    // Reset keranjang
    state.cart = [];
    renderCart();
  }
});

async function saveTransaction(tx) {
  saveToHistory(tx);

  const sqlReceipt = `
    INSERT INTO pos_receipts (receipt_number, transaction_date, subtotal, grand_total, cashier_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  const receiptArgs = [
    tx.receipt_number, tx.transaction_date, tx.subtotal, tx.grand_total,
    tx.cashier_id || "kasir", new Date().toISOString()
  ];

  const itemStatements = tx.items.map((item, idx) => {
    const strId = `${tx.receipt_number}_${item.sku}_${idx}`;
    let hash = 0;
    for (let i = 0; i < strId.length; i++) {
      hash = ((hash << 5) - hash) + strId.charCodeAt(i);
      hash |= 0;
    }
    const safeId = Math.abs(hash);

    return {
      sql: `INSERT INTO pos_receipt_items (id, receipt_number, product_sku, quantity, unit_price, transaction_date, transaction_time, cashier_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [safeId, tx.receipt_number, item.sku, item.qty, item.price, tx.transaction_date, tx.transaction_time, tx.cashier_id || "kasir"]
    };
  });

  if (state.isOnline) {
    try {
      const requests = [
        { type: "execute", stmt: { sql: sqlReceipt, args: typedTursoArgs(receiptArgs) } },
        ...itemStatements.map(st => ({
          type: "execute",
          stmt: { sql: st.sql, args: typedTursoArgs(st.args) }
        })),
        { type: "close" }
      ];

      const res = await fetch(TURSO_CONFIG.url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${TURSO_CONFIG.token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ requests })
      });

      if (res.ok) {
        showToast("✅ Transaksi sukses disimpan ke Turso Cloud!");
        return;
      }
    } catch (e) {
      console.warn("Gagal kirim ke Turso, simpan antrean offline:", e);
    }
  }

  queueOfflineTransaction(tx);
  showToast("💾 Transaksi disimpan di memori HP (Mode Offline)");
}

function typedTursoArgs(args) {
  return args.map(arg => {
    if (arg === null || arg === undefined) return { type: "null" };
    if (typeof arg === "number") {
      return Number.isInteger(arg) ? { type: "integer", value: String(arg) } : { type: "float", value: arg };
    }
    return { type: "text", value: String(arg) };
  });
}

function queueOfflineTransaction(tx) {
  const queue = JSON.parse(localStorage.getItem(STORAGE_KEYS.OFFLINE_QUEUE) || '[]');
  queue.push(tx);
  localStorage.setItem(STORAGE_KEYS.OFFLINE_QUEUE, JSON.stringify(queue));
  checkOfflineQueue();
}

function checkOfflineQueue() {
  const queue = JSON.parse(localStorage.getItem(STORAGE_KEYS.OFFLINE_QUEUE) || '[]');
  const banner = document.getElementById('offlineBanner');
  if (queue.length > 0) {
    banner.innerText = `⚠️ Ada ${queue.length} transaksi offline di HP. Klik ikon 🔄 untuk sinkron ke Cloud.`;
    banner.style.display = 'block';
  } else if (!state.isOnline) {
    banner.innerText = '⚠️ Mode Offline: Anda tetap bisa jualan tanpa internet.';
    banner.style.display = 'block';
  } else {
    banner.style.display = 'none';
  }
}

async function flushOfflineQueue() {
  const queue = JSON.parse(localStorage.getItem(STORAGE_KEYS.OFFLINE_QUEUE) || '[]');
  if (queue.length === 0) return;

  const remaining = [];
  for (const tx of queue) {
    try {
      await saveTransactionToTursoDirect(tx);
    } catch (e) {
      remaining.push(tx);
    }
  }

  localStorage.setItem(STORAGE_KEYS.OFFLINE_QUEUE, JSON.stringify(remaining));
  checkOfflineQueue();
  if (remaining.length === 0) {
    showToast(`✅ ${queue.length} transaksi offline berhasil di-sync ke Cloud!`);
  }
}

async function saveTransactionToTursoDirect(tx) {
  const sqlReceipt = `
    INSERT OR REPLACE INTO pos_receipts (receipt_number, transaction_date, subtotal, grand_total, cashier_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  const receiptArgs = [tx.receipt_number, tx.transaction_date, tx.subtotal, tx.grand_total, tx.customer_code, new Date().toISOString()];

  const itemStatements = tx.items.map((item, idx) => {
    const strId = `${tx.receipt_number}_${item.sku}_${idx}`;
    let hash = 0;
    for (let i = 0; i < strId.length; i++) {
      hash = ((hash << 5) - hash) + strId.charCodeAt(i);
      hash |= 0;
    }
    const safeId = Math.abs(hash);
    return {
      sql: `INSERT OR REPLACE INTO pos_receipt_items (id, receipt_number, product_sku, quantity, unit_price, transaction_date, transaction_time, cashier_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [safeId, tx.receipt_number, item.sku, item.qty, item.price, tx.transaction_date, tx.transaction_time, tx.customer_code]
    };
  });

  const requests = [
    { type: "execute", stmt: { sql: sqlReceipt, args: typedTursoArgs(receiptArgs) } },
    ...itemStatements.map(st => ({
      type: "execute",
      stmt: { sql: st.sql, args: typedTursoArgs(st.args) }
    })),
    { type: "close" }
  ];

  const res = await fetch(TURSO_CONFIG.url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TURSO_CONFIG.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ requests })
  });

  if (!res.ok) throw new Error("Sync failed");
}

function saveToHistory(tx) {
  const history = JSON.parse(localStorage.getItem(STORAGE_KEYS.HISTORY) || '[]');
  history.unshift(tx);
  if (history.length > 50) history.pop();
  localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
}

// =============================================================================
// 9. STRUK PRESISI TINGGI (HTML & 80MM PRINTER THERMAL)
// =============================================================================
const receiptModal = document.getElementById('receiptModal');
const receiptPaper = document.getElementById('receiptPaper');
const printableReceiptArea = document.getElementById('printableReceiptArea');
const btnCloseReceipt = document.getElementById('btnCloseReceipt');
const btnPrintReceipt = document.getElementById('btnPrintReceipt');
const btnShareWA = document.getElementById('btnShareWA');
const btnNewOrder = document.getElementById('btnNewOrder');

function buildHtmlReceipt(tx) {
  let itemsHtml = '';
  tx.items.forEach(it => {
    itemsHtml += `
      <div class="receipt-item-row">
        <div class="receipt-item-name">${escapeHtml(it.name)}</div>
        <div class="receipt-item-calc">
          <span>${it.qty} x ${formatAngka(it.price)}</span>
          <span style="font-weight: 700;">${formatAngka(it.subtotal)}</span>
        </div>
      </div>
    `;
  });

  const footerFormatted = escapeHtml(storeConfig.store_footer).replace(/\n/g, '<br>');

  return `
    <div class="receipt-header">
      <div class="receipt-store-name">${escapeHtml(storeConfig.store_name)}</div>
      <div class="receipt-store-address">${escapeHtml(storeConfig.store_address)}</div>
      <div class="receipt-store-phone">Telp: ${escapeHtml(storeConfig.store_phone)}</div>
    </div>
    <div class="receipt-divider-double"></div>
    <div class="receipt-meta-row"><span>No. Nota:</span> <span>${escapeHtml(tx.receipt_number)}</span></div>
    <div class="receipt-meta-row"><span>Tanggal :</span> <span>${tx.transaction_date} ${tx.transaction_time}</span></div>
    <div class="receipt-meta-row"><span>Kasir   :</span> <span>${escapeHtml(tx.cashier_name || tx.cashier_id || 'KASIR')}</span></div>
    <div class="receipt-meta-row"><span>Plg     :</span> <span>${escapeHtml(tx.customer_code)}</span></div>
    <div class="receipt-divider"></div>
    <div class="receipt-items-table">
      ${itemsHtml}
    </div>
    <div class="receipt-divider"></div>
    <div class="receipt-calc-row">
      <span class="receipt-total-bold">TOTAL</span>
      <span class="receipt-total-bold">${formatRupiah(tx.grand_total)}</span>
    </div>
    <div class="receipt-calc-row">
      <span>BAYAR</span>
      <span>${formatRupiah(tx.paid)}</span>
    </div>
    <div class="receipt-calc-row">
      <span>KEMBALI</span>
      <span>${formatRupiah(tx.change)}</span>
    </div>
    <div class="receipt-divider-double"></div>
    <div class="receipt-footer">
      ${footerFormatted}
    </div>
  `;
}

function buildPlainTextReceipt(tx) {
  // Format monospace untuk WhatsApp
  const w = storeConfig.paper_width === 58 ? 32 : 44;
  const line = "-".repeat(w);
  const dLine = "=".repeat(w);

  let out = "";
  out += centerText(storeConfig.store_name, w) + "\n";
  out += centerText(storeConfig.store_address, w) + "\n";
  out += centerText("Telp: " + storeConfig.store_phone, w) + "\n";
  out += dLine + "\n";
  out += `No   : ${tx.receipt_number}\n`;
  out += `Tgl  : ${tx.transaction_date} ${tx.transaction_time}\n`;
  out += `Kasir: ${tx.cashier_name || tx.cashier_id || "KASIR"}\n`;
  out += `Plg  : ${tx.customer_code}\n`;
  out += line + "\n";

  tx.items.forEach(it => {
    out += `${it.name}\n`;
    const left = `  ${it.qty} x ${formatAngka(it.price)}`;
    const right = formatAngka(it.subtotal);
    const space = Math.max(1, w - left.length - right.length);
    out += left + " ".repeat(space) + right + "\n";
  });

  out += line + "\n";
  out += padRow("TOTAL", formatRupiah(tx.grand_total), w) + "\n";
  out += padRow("BAYAR", formatRupiah(tx.paid), w) + "\n";
  out += padRow("KEMBALI", formatRupiah(tx.change), w) + "\n";
  out += dLine + "\n";
  storeConfig.store_footer.split("\n").forEach(l => {
    out += centerText(l.trim(), w) + "\n";
  });

  return out;
}

function centerText(text, width) {
  const pad = Math.max(0, Math.floor((width - text.length) / 2));
  return " ".repeat(pad) + text;
}

function padRow(left, right, width) {
  const space = Math.max(1, width - left.length - right.length);
  return left + " ".repeat(space) + right;
}

function showReceiptModal(tx) {
  state.activeTransaction = tx;
  const html = buildHtmlReceipt(tx);
  receiptPaper.innerHTML = html;
  
  // Set juga ke area cetak khusus printer thermal
  printableReceiptArea.innerHTML = html;
  
  receiptModal.classList.add('active');
}

// Fungsi Cetak Langsung RawBT (Rol Kertas Panjang Tanpa Batas Halaman)
function printToRawBT(tx) {
  if (!tx) return;
  const text = buildPlainTextReceipt(tx);
  try {
    const utf8Bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < utf8Bytes.length; i++) {
      binary += String.fromCharCode(utf8Bytes[i]);
    }
    const b64 = btoa(binary);
    window.location.href = "rawbt:data:base64," + b64;
  } catch (e) {
    window.location.href = "rawbt:data:base64," + btoa(unescape(encodeURIComponent(text)));
  }
}

const btnPrintRawBT = document.getElementById('btnPrintRawBT');
if (btnPrintRawBT) {
  btnPrintRawBT.addEventListener('click', () => {
    if (state.activeTransaction) {
      printToRawBT(state.activeTransaction);
    }
  });
}

const btnDetailRawBT = document.getElementById('btnDetailRawBT');
if (btnDetailRawBT) {
  btnDetailRawBT.addEventListener('click', () => {
    if (activeDetailTx) {
      printToRawBT(activeDetailTx);
    }
  });
}

btnCloseReceipt.addEventListener('click', () => receiptModal.classList.remove('active'));
btnNewOrder.addEventListener('click', () => {
  receiptModal.classList.remove('active');
  searchInput.focus();
});

btnPrintReceipt.addEventListener('click', () => {
  // Update area cetak
  if (state.activeTransaction) {
    printableReceiptArea.innerHTML = buildHtmlReceipt(state.activeTransaction);
  }
  window.print();
});

btnShareWA.addEventListener('click', () => {
  if (!state.activeTransaction) return;
  const text = buildPlainTextReceipt(state.activeTransaction);
  const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
  window.open(waUrl, '_blank');
});

// =============================================================================
// 10. LAPORAN & STORY TRANSAKSI LENGKAP
// =============================================================================
const btnOpenReport = document.getElementById('btnOpenReport');
const reportModal = document.getElementById('reportModal');
const btnCloseReport = document.getElementById('btnCloseReport');
const reportTotalOmset = document.getElementById('reportTotalOmset');
const reportTotalNota = document.getElementById('reportTotalNota');
const reportTotalItems = document.getElementById('reportTotalItems');
const reportListContainer = document.getElementById('reportListContainer');

btnOpenReport.addEventListener('click', () => {
  if (state.currentUser?.role !== 'admin') {
    alert("⚠️ Akses Dibatasi!\nLaporan penjualan & omset toko hanya dapat dibuka oleh Akun Owner/Admin.");
    return;
  }
  reportModal.classList.add('active');
  loadReportData(state.reportPeriod);
});

btnCloseReport.addEventListener('click', () => reportModal.classList.remove('active'));

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.reportPeriod = btn.getAttribute('data-period');
    loadReportData(state.reportPeriod);
  });
});

async function loadReportData(period = 'today') {
  reportListContainer.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 24px;">Memuat riwayat transaksi...</div>';

  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysStr = sevenDaysAgo.toISOString().slice(0, 10);

  const monthPrefix = todayStr.slice(0, 7); // YYYY-MM

  // 1. Ambil transaksi dari riwayat lokal
  const localHistory = JSON.parse(localStorage.getItem(STORAGE_KEYS.HISTORY) || '[]');

  // 2. Ambil transaksi dari Turso Cloud (jika online)
  let cloudReceipts = [];
  if (state.isOnline) {
    try {
      let whereClause = "";
      let args = [];
      if (period === 'today') {
        whereClause = "WHERE transaction_date = ?";
        args = [todayStr];
      } else if (period === 'yesterday') {
        whereClause = "WHERE transaction_date = ?";
        args = [yesterdayStr];
      } else if (period === 'week') {
        whereClause = "WHERE transaction_date >= ?";
        args = [sevenDaysStr];
      } else if (period === 'month') {
        whereClause = "WHERE transaction_date LIKE ?";
        args = [monthPrefix + '%'];
      }

      cloudReceipts = await queryTurso(
        `SELECT receipt_number, transaction_date, grand_total, cashier_id, created_at 
         FROM pos_receipts ${whereClause} 
         ORDER BY transaction_date DESC, created_at DESC LIMIT 50`,
        args
      );
    } catch (e) {
      console.warn("Gagal load transaksi cloud:", e);
    }
  }

  // 3. Gabungkan transaksi cloud dan lokal (hindari duplikasi berdasarkan receipt_number)
  const combinedMap = new Map();

  localHistory.forEach(tx => {
    let match = false;
    if (period === 'today' && tx.transaction_date === todayStr) match = true;
    else if (period === 'yesterday' && tx.transaction_date === yesterdayStr) match = true;
    else if (period === 'week' && tx.transaction_date >= sevenDaysStr) match = true;
    else if (period === 'month' && tx.transaction_date.startsWith(monthPrefix)) match = true;
    else if (period === 'all') match = true;

    if (match) {
      combinedMap.set(tx.receipt_number, {
        receipt_number: tx.receipt_number,
        transaction_date: tx.transaction_date,
        transaction_time: tx.transaction_time || "",
        grand_total: tx.grand_total,
        cashier_id: tx.customer_code || "UMUM",
        items: tx.items || [],
        source: 'local'
      });
    }
  });

  cloudReceipts.forEach(cr => {
    if (!combinedMap.has(cr.receipt_number)) {
      combinedMap.set(cr.receipt_number, {
        receipt_number: cr.receipt_number,
        transaction_date: cr.transaction_date,
        transaction_time: cr.created_at ? cr.created_at.slice(11, 19) : "",
        grand_total: parseFloat(cr.grand_total) || 0,
        cashier_id: cr.cashier_id || "UMUM",
        items: [],
        source: 'cloud'
      });
    }
  });

  const list = Array.from(combinedMap.values());

  // Hitung total ringkasan
  let totalOmset = 0;
  let totalNota = list.length;
  let totalItemsCount = 0;

  list.forEach(tx => {
    totalOmset += tx.grand_total;
    if (tx.items && tx.items.length > 0) {
      totalItemsCount += tx.items.reduce((s, it) => s + (it.qty || 1), 0);
    }
  });

  reportTotalOmset.innerText = formatRupiah(totalOmset);
  reportTotalNota.innerText = totalNota;
  reportTotalItems.innerText = totalItemsCount > 0 ? `${totalItemsCount} Pcs` : `${totalNota} Transaksi`;

  if (list.length === 0) {
    reportListContainer.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 30px;">Tidak ada transaksi pada periode ini.</div>';
    return;
  }

  let html = '';
  list.forEach((tx, idx) => {
    const badge = tx.source === 'cloud' 
      ? '<span style="font-size: 10px; color: var(--accent-emerald); background: rgba(16,185,129,0.15); padding: 2px 6px; border-radius: 10px;">Cloud</span>'
      : '<span style="font-size: 10px; color: var(--accent-sky); background: rgba(2,132,199,0.15); padding: 2px 6px; border-radius: 10px;">Lokal HP</span>';

    html += `
      <div class="history-item-card" onclick="openTransactionDetail('${escapeHtml(tx.receipt_number)}')">
        <div>
          <div style="font-weight: 700; font-size: 14px; color: var(--text-main); display: flex; align-items: center; gap: 6px;">
            ${escapeHtml(tx.receipt_number)} ${badge}
          </div>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
            ${tx.transaction_date} ${tx.transaction_time} • Plg: ${escapeHtml(tx.cashier_id)}
          </div>
          <div style="font-size: 14px; font-weight: 800; color: var(--accent-emerald); margin-top: 4px;">
            ${formatRupiah(tx.grand_total)}
          </div>
        </div>
        <div style="font-size: 20px; color: var(--text-muted);">›</div>
      </div>
    `;
  });

  reportListContainer.innerHTML = html;
}

// Modal Detail Transaksi
const txDetailModal = document.getElementById('txDetailModal');
const txDetailTitle = document.getElementById('txDetailTitle');
const txDetailInfoBox = document.getElementById('txDetailInfoBox');
const txDetailItemsContainer = document.getElementById('txDetailItemsContainer');
const btnCloseTxDetail = document.getElementById('btnCloseTxDetail');
const btnDetailPrint = document.getElementById('btnDetailPrint');
const btnDetailWA = document.getElementById('btnDetailWA');

let activeDetailTx = null;

async function openTransactionDetail(receiptNumber) {
  txDetailTitle.innerText = `Nota: ${receiptNumber}`;
  txDetailInfoBox.innerHTML = 'Memuat rincian barang...';
  txDetailItemsContainer.innerHTML = '';
  txDetailModal.classList.add('active');

  // Cari di lokal dulu
  const localHistory = JSON.parse(localStorage.getItem(STORAGE_KEYS.HISTORY) || '[]');
  let tx = localHistory.find(t => t.receipt_number === receiptNumber);

  // Jika tidak lengkap, query Turso untuk detail items
  if (!tx || !tx.items || tx.items.length === 0) {
    try {
      const items = await queryTurso(
        `SELECT product_sku, quantity, unit_price FROM pos_receipt_items WHERE receipt_number = ?`,
        [receiptNumber]
      );
      const receipt = await queryTurso(
        `SELECT receipt_number, transaction_date, grand_total, cashier_id FROM pos_receipts WHERE receipt_number = ?`,
        [receiptNumber]
      );

      if (receipt && receipt.length > 0) {
        const r = receipt[0];
        tx = {
          receipt_number: r.receipt_number,
          transaction_date: r.transaction_date,
          transaction_time: "",
          customer_code: r.cashier_id || "UMUM",
          grand_total: parseFloat(r.grand_total) || 0,
          paid: parseFloat(r.grand_total) || 0,
          change: 0,
          items: items.map(it => {
            const p = state.products.find(prod => prod.sku === it.product_sku);
            return {
              sku: it.product_sku,
              name: p ? p.name : `Produk ${it.product_sku}`,
              qty: parseFloat(it.quantity) || 1,
              price: parseFloat(it.unit_price) || 0,
              subtotal: (parseFloat(it.quantity) || 1) * (parseFloat(it.unit_price) || 0)
            };
          })
        };
      }
    } catch (e) {
      console.warn("Gagal load item detail:", e);
    }
  }

  if (!tx) {
    txDetailInfoBox.innerHTML = '<div style="color: var(--accent-rose);">Data nota tidak ditemukan.</div>';
    return;
  }

  activeDetailTx = tx;

  txDetailInfoBox.innerHTML = `
    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
      <span style="color: var(--text-muted);">No. Nota:</span>
      <span style="font-weight: 700;">${escapeHtml(tx.receipt_number)}</span>
    </div>
    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
      <span style="color: var(--text-muted);">Tanggal:</span>
      <span>${tx.transaction_date} ${tx.transaction_time || ''}</span>
    </div>
    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
      <span style="color: var(--text-muted);">Pelanggan:</span>
      <span>${escapeHtml(tx.customer_code || 'UMUM')}</span>
    </div>
    <div style="display: flex; justify-content: space-between; margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--border-color);">
      <span style="font-weight: 700;">Total Belanja:</span>
      <span style="font-weight: 800; font-size: 16px; color: var(--accent-emerald);">${formatRupiah(tx.grand_total)}</span>
    </div>
  `;

  let itemsHtml = '';
  if (tx.items && tx.items.length > 0) {
    tx.items.forEach(it => {
      itemsHtml += `
        <div style="background: var(--bg-card); padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 600; font-size: 13px;">${escapeHtml(it.name)}</div>
            <div style="font-size: 12px; color: var(--text-muted);">${it.qty} x ${formatRupiah(it.price)}</div>
          </div>
          <div style="font-weight: 700; color: var(--accent-emerald); font-size: 14px;">
            ${formatRupiah(it.subtotal)}
          </div>
        </div>
      `;
    });
  } else {
    itemsHtml = '<div style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 12px;">Rincian barang tidak tersimpan di riwayat lokal.</div>';
  }

  txDetailItemsContainer.innerHTML = itemsHtml;
}

btnCloseTxDetail.addEventListener('click', () => txDetailModal.classList.remove('active'));

btnDetailPrint.addEventListener('click', () => {
  if (activeDetailTx) {
    txDetailModal.classList.remove('active');
    reportModal.classList.remove('active');
    showReceiptModal(activeDetailTx);
  }
});

btnDetailWA.addEventListener('click', () => {
  if (activeDetailTx) {
    const text = buildPlainTextReceipt(activeDetailTx);
    const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(waUrl, '_blank');
  }
});

// =============================================================================
// 11. PENGATURAN TOKO & PRINTER THERMAL (80MM / 58MM)
// =============================================================================
const btnOpenSettings = document.getElementById('btnOpenSettings');
const settingsModal = document.getElementById('settingsModal');
const btnCloseSettings = document.getElementById('btnCloseSettings');
const cfgPaperWidth = document.getElementById('cfgPaperWidth');
const cfgStoreName = document.getElementById('cfgStoreName');
const cfgStoreAddress = document.getElementById('cfgStoreAddress');
const cfgStorePhone = document.getElementById('cfgStorePhone');
const cfgStoreFooter = document.getElementById('cfgStoreFooter');
const btnSaveSettings = document.getElementById('btnSaveSettings');

btnOpenSettings.addEventListener('click', () => {
  if (state.currentUser?.role !== 'admin') {
    alert("⚠️ Akses Dibatasi!\nPengaturan toko & printer hanya dapat diakses oleh Akun Owner/Admin.");
    return;
  }
  cfgPaperWidth.value = String(storeConfig.paper_width);
  cfgStoreName.value = storeConfig.store_name;
  cfgStoreAddress.value = storeConfig.store_address;
  cfgStorePhone.value = storeConfig.store_phone;
  cfgStoreFooter.value = storeConfig.store_footer;
  settingsModal.classList.add('active');
});

btnCloseSettings.addEventListener('click', () => settingsModal.classList.remove('active'));

btnSaveSettings.addEventListener('click', () => {
  storeConfig.paper_width = parseInt(cfgPaperWidth.value) || 80;
  storeConfig.store_name = cfgStoreName.value.trim() || "TOKO BEBENG";
  storeConfig.store_address = cfgStoreAddress.value.trim() || "";
  storeConfig.store_phone = cfgStorePhone.value.trim() || "";
  storeConfig.store_footer = cfgStoreFooter.value.trim() || "";

  localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(storeConfig));
  document.getElementById('headerStoreName').innerText = storeConfig.store_name;

  settingsModal.classList.remove('active');
  showToast(`✅ Pengaturan tersimpan (Printer ${storeConfig.paper_width}mm)`);
});

// =============================================================================
// 12. MASTER BARANG & UBAH HARGA
// =============================================================================
const btnOpenProducts = document.getElementById('btnOpenProducts');
const productsModal = document.getElementById('productsModal');
const btnCloseProducts = document.getElementById('btnCloseProducts');
const btnAddNewProduct = document.getElementById('btnAddNewProduct');
const btnScanToEdit = document.getElementById('btnScanToEdit');
const productManagerSearch = document.getElementById('productManagerSearch');
const productManagerList = document.getElementById('productManagerList');

const productFormModal = document.getElementById('productFormModal');
const productFormTitle = document.getElementById('productFormTitle');
const btnCloseProductForm = document.getElementById('btnCloseProductForm');
const formProductSku = document.getElementById('formProductSku');
const formIsEditMode = document.getElementById('formIsEditMode');
const formProductBarcode = document.getElementById('formProductBarcode');
const btnScanBarcodeForForm = document.getElementById('btnScanBarcodeForForm');
const formProductName = document.getElementById('formProductName');
const formProductSellingPrice = document.getElementById('formProductSellingPrice');
const formProductPurchasePrice = document.getElementById('formProductPurchasePrice');
const formProductCategory = document.getElementById('formProductCategory');
const btnSaveProduct = document.getElementById('btnSaveProduct');
const btnDeleteProduct = document.getElementById('btnDeleteProduct');

if (btnOpenProducts) {
  btnOpenProducts.addEventListener('click', () => {
    if (state.currentUser?.role !== 'admin') {
      alert("⚠️ Akses Dibatasi!\nHanya Akun Owner/Admin yang diizinkan untuk mengelola barang dan mengubah harga.");
      return;
    }
    productManagerSearch.value = '';
    renderProductManagerList();
    productsModal.classList.add('active');
  });
}

if (btnCloseProducts) {
  btnCloseProducts.addEventListener('click', () => {
    productsModal.classList.remove('active');
  });
}

if (productManagerSearch) {
  productManagerSearch.addEventListener('input', (e) => {
    renderProductManagerList(e.target.value.trim());
  });
}

function renderProductManagerList(filterText = '') {
  const query = filterText.toLowerCase();
  let list = state.products;

  if (query) {
    list = list.filter(p => 
      p.name.toLowerCase().includes(query) ||
      (p.barcode && p.barcode.toLowerCase().includes(query)) ||
      p.sku.toLowerCase().includes(query) ||
      (p.category && p.category.toLowerCase().includes(query))
    );
  }

  const displayList = list.slice(0, 50);

  if (displayList.length === 0) {
    productManagerList.innerHTML = `
      <div style="text-align: center; padding: 28px 16px; color: var(--text-muted); font-size: 13px;">
        🔍 Barang tidak ditemukan.<br>
        <button id="btnQuickCreateFromSearch" class="btn-scan" style="margin-top: 12px; display: inline-flex;">
          ➕ Tambah Sebagai Barang Baru
        </button>
      </div>
    `;
    const btnQuick = document.getElementById('btnQuickCreateFromSearch');
    if (btnQuick) {
      btnQuick.addEventListener('click', () => {
        openNewProductModal('', filterText);
      });
    }
    return;
  }

  let html = '';
  displayList.forEach(p => {
    html += `
      <div class="product-manage-card">
        <div class="product-manage-info">
          <div class="product-manage-name">${escapeHtml(p.name)}</div>
          <div class="product-manage-meta">
            ${p.barcode ? `Barcode: <b style="color: var(--accent-sky);">${escapeHtml(p.barcode)}</b>` : `SKU: ${escapeHtml(p.sku)}`}
            ${p.purchase_price ? ` • Modal: ${formatRupiah(p.purchase_price)}` : ''}
            ${p.category ? ` • ${escapeHtml(p.category)}` : ''}
          </div>
        </div>
        <div class="product-manage-prices">
          <div style="font-size: 15px; font-weight: 800; color: var(--accent-emerald);">
            ${formatRupiah(p.price)}
          </div>
          <button class="btn-edit-price" data-sku="${escapeHtml(p.sku)}">
            ✏️ Ubah
          </button>
        </div>
      </div>
    `;
  });

  if (list.length > 50) {
    html += `
      <div style="text-align: center; padding: 10px; font-size: 12px; color: var(--text-muted);">
        Menampilkan 50 dari ${list.length} barang. Ketik nama/barcode lebih spesifik untuk menyaring.
      </div>
    `;
  }

  productManagerList.innerHTML = html;

  const editButtons = productManagerList.querySelectorAll('.btn-edit-price');
  editButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const sku = e.currentTarget.getAttribute('data-sku');
      openEditProductModal(sku);
    });
  });
}

if (btnAddNewProduct) {
  btnAddNewProduct.addEventListener('click', () => {
    openNewProductModal();
  });
}

if (btnScanToEdit) {
  btnScanToEdit.addEventListener('click', () => {
    state.scannerMode = 'scanToEdit';
    scannerModal.classList.add('active');
    startScanner();
  });
}

if (btnScanBarcodeForForm) {
  btnScanBarcodeForForm.addEventListener('click', () => {
    state.scannerMode = 'fillBarcode';
    scannerModal.classList.add('active');
    startScanner();
  });
}

function openNewProductModal(prefillBarcode = '', prefillName = '') {
  productFormTitle.innerText = "➕ Tambah Barang Baru";
  formIsEditMode.value = "0";
  formProductSku.value = "";
  formProductBarcode.value = prefillBarcode || "";
  formProductName.value = prefillName || "";
  formProductSellingPrice.value = "";
  formProductPurchasePrice.value = "";
  formProductCategory.value = "";
  btnDeleteProduct.style.display = 'none';

  productFormModal.classList.add('active');
  setTimeout(() => {
    if (!formProductName.value) {
      formProductName.focus();
    } else {
      formProductSellingPrice.focus();
    }
  }, 200);
}

function openEditProductModal(sku) {
  const product = state.products.find(p => p.sku === sku);
  if (!product) {
    showToast("⚠️ Data barang tidak ditemukan");
    return;
  }

  productFormTitle.innerText = "✏️ Ubah Harga & Barang";
  formIsEditMode.value = "1";
  formProductSku.value = product.sku;
  formProductBarcode.value = product.barcode || "";
  formProductName.value = product.name;
  formProductSellingPrice.value = product.price || "";
  formProductPurchasePrice.value = product.purchase_price || "";
  formProductCategory.value = product.category || "";
  btnDeleteProduct.style.display = 'block';

  productFormModal.classList.add('active');
  setTimeout(() => {
    formProductSellingPrice.focus();
    formProductSellingPrice.select();
  }, 200);
}

if (btnCloseProductForm) {
  btnCloseProductForm.addEventListener('click', () => {
    productFormModal.classList.remove('active');
  });
}

if (btnSaveProduct) {
  btnSaveProduct.addEventListener('click', async () => {
    const isEdit = formIsEditMode.value === "1";
    let sku = formProductSku.value.trim();
    const barcode = formProductBarcode.value.trim();
    const name = formProductName.value.trim();
    const sellingPrice = parseFloat(formProductSellingPrice.value) || 0;
    const purchasePrice = parseFloat(formProductPurchasePrice.value) || 0;
    const category = formProductCategory.value.trim();

    if (!name) {
      alert("Nama barang wajib diisi!");
      formProductName.focus();
      return;
    }

    if (sellingPrice <= 0) {
      alert("Harga jual wajib diisi dan harus lebih dari 0!");
      formProductSellingPrice.focus();
      return;
    }

    btnSaveProduct.disabled = true;
    btnSaveProduct.innerText = "⏳ Menyimpan ke Turso Cloud...";

    try {
      if (!isEdit) {
        if (!sku) {
          sku = "B-" + Date.now().toString().slice(-6);
        }

        const existSku = state.products.find(p => p.sku.toLowerCase() === sku.toLowerCase());
        if (existSku) {
          sku = "B-" + Date.now().toString().slice(-7);
        }

        if (barcode) {
          const existBarcode = state.products.find(p => p.barcode && p.barcode.toLowerCase() === barcode.toLowerCase());
          if (existBarcode) {
            if (!confirm(`Barcode '${barcode}' sudah dipakai barang:\n"${existBarcode.name}"\nTetap gunakan barcode ini?`)) {
              btnSaveProduct.disabled = false;
              btnSaveProduct.innerText = "💾 SIMPAN KE CLOUD TURSO";
              return;
            }
          }
        }

        const sql = `
          INSERT INTO products (sku, barcode_slop, name, purchase_price, selling_price, wholesale_price, category, is_active, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
        `;
        const args = [sku, barcode, name, purchasePrice, sellingPrice, 0, category];

        await queryTurso(sql, args);

        const newProduct = {
          sku,
          barcode,
          name,
          price: sellingPrice,
          purchase_price: purchasePrice,
          wholesale_price: 0,
          category
        };
        state.products.unshift(newProduct);
        localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(state.products));
        updateProductCountDisplay();

        productFormModal.classList.remove('active');
        renderProductManagerList(productManagerSearch.value);
        showToast(`✅ Barang '${name}' berhasil ditambahkan!`);
        playBeep(880, 0.15);

      } else {
        const sql = `
          UPDATE products
          SET barcode_slop = ?, name = ?, selling_price = ?, purchase_price = ?, category = ?, updated_at = datetime('now')
          WHERE sku = ?
        `;
        const args = [barcode, name, sellingPrice, purchasePrice, category, sku];

        await queryTurso(sql, args);

        const target = state.products.find(p => p.sku === sku);
        if (target) {
          target.barcode = barcode;
          target.name = name;
          target.price = sellingPrice;
          target.purchase_price = purchasePrice;
          target.category = category;
        }

        const cartItem = state.cart.find(c => c.sku === sku);
        if (cartItem) {
          cartItem.price = sellingPrice;
          cartItem.name = name;
          cartItem.subtotal = cartItem.qty * cartItem.price;
          renderCart();
        }

        localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(state.products));

        productFormModal.classList.remove('active');
        renderProductManagerList(productManagerSearch.value);
        showToast(`✅ Harga '${name}' diubah jadi ${formatRupiah(sellingPrice)}!`);
        playBeep(880, 0.15);
      }
    } catch (err) {
      console.error("Gagal simpan barang:", err);
      alert("⚠️ Gagal menyimpan ke Cloud Turso: " + (err.message || err));
    } finally {
      btnSaveProduct.disabled = false;
      btnSaveProduct.innerText = "💾 SIMPAN KE CLOUD TURSO";
    }
  });
}

if (btnDeleteProduct) {
  btnDeleteProduct.addEventListener('click', async () => {
    const sku = formProductSku.value.trim();
    const name = formProductName.value.trim();
    if (!sku) return;

    if (!confirm(`Hapus barang "${name}"?\n(Barang tidak akan muncul lagi di pencarian kasir)`)) {
      return;
    }

    btnDeleteProduct.disabled = true;
    btnDeleteProduct.innerText = "⏳ Menghapus...";

    try {
      const sql = `UPDATE products SET is_active = 0, updated_at = datetime('now') WHERE sku = ?`;
      await queryTurso(sql, [sku]);

      state.products = state.products.filter(p => p.sku !== sku);
      state.cart = state.cart.filter(c => c.sku !== sku);
      renderCart();

      localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(state.products));
      updateProductCountDisplay();

      productFormModal.classList.remove('active');
      renderProductManagerList(productManagerSearch.value);
      showToast(`🗑️ Barang '${name}' berhasil dihapus.`);
    } catch (err) {
      console.error("Gagal hapus barang:", err);
      alert("⚠️ Gagal menghapus barang: " + (err.message || err));
    } finally {
      btnDeleteProduct.disabled = false;
      btnDeleteProduct.innerText = "🗑️ Hapus Barang Ini";
    }
  });
}

// =============================================================================
// 13. KELOLA PENGGUNA, LOGIN & HAK AKSES (RBAC)
// =============================================================================
const loginOverlay = document.getElementById('loginOverlay');
const loginUserSelect = document.getElementById('loginUserSelect');
const loginPinInput = document.getElementById('loginPinInput');
const btnLoginSubmit = document.getElementById('btnLoginSubmit');
const loginForm = document.getElementById('loginForm');

const btnUserMenu = document.getElementById('btnUserMenu');
const userModal = document.getElementById('userModal');
const btnCloseUserModal = document.getElementById('btnCloseUserModal');
const profileUserName = document.getElementById('profileUserName');
const profileUserRole = document.getElementById('profileUserRole');
const btnOpenManageUsers = document.getElementById('btnOpenManageUsers');
const btnLogout = document.getElementById('btnLogout');

const manageUsersModal = document.getElementById('manageUsersModal');
const btnCloseManageUsers = document.getElementById('btnCloseManageUsers');
const btnAddNewUser = document.getElementById('btnAddNewUser');
const usersListContainer = document.getElementById('usersListContainer');

const userFormModal = document.getElementById('userFormModal');
const userFormTitle = document.getElementById('userFormTitle');
const btnCloseUserForm = document.getElementById('btnCloseUserForm');
const formUserIsEdit = document.getElementById('formUserIsEdit');
const formUserUsername = document.getElementById('formUserUsername');
const formUserFullName = document.getElementById('formUserFullName');
const formUserPin = document.getElementById('formUserPin');
const formUserRole = document.getElementById('formUserRole');
const btnSaveUser = document.getElementById('btnSaveUser');

// Touch Numpad Handler
document.querySelectorAll('.pin-key').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const val = e.currentTarget.getAttribute('data-val');
    if (!loginPinInput) return;
    if (val === 'clear') {
      loginPinInput.value = '';
    } else if (val === 'del') {
      loginPinInput.value = loginPinInput.value.slice(0, -1);
    } else if (val) {
      if (loginPinInput.value.length < 8) {
        loginPinInput.value += val;
      }
    }
  });
});

function renderLoginUserOptions() {
  if (!loginUserSelect) return;
  const currentVal = loginUserSelect.value;
  loginUserSelect.innerHTML = '';
  state.users.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.username;
    opt.textContent = `${u.role === 'admin' ? '👑' : '👤'} ${u.name} (${u.role === 'admin' ? 'Owner' : 'Kasir'})`;
    loginUserSelect.appendChild(opt);
  });
  if (currentVal) loginUserSelect.value = currentVal;
}

function applyUserRolePermissions() {
  const activeUserBadge = document.getElementById('activeUserBadge');
  const btnOpenProducts = document.getElementById('btnOpenProducts');
  const btnOpenReport = document.getElementById('btnOpenReport');
  const btnOpenSettings = document.getElementById('btnOpenSettings');

  if (!state.currentUser) {
    if (loginOverlay) loginOverlay.classList.remove('hidden');
    if (activeUserBadge) activeUserBadge.innerText = '👤 Masuk';
    if (btnOpenProducts) btnOpenProducts.style.display = 'none';
    if (btnOpenReport) btnOpenReport.style.display = 'none';
    if (btnOpenSettings) btnOpenSettings.style.display = 'none';
    return;
  }

  // User sudah login
  if (loginOverlay) loginOverlay.classList.add('hidden');
  const isAdmin = state.currentUser.role === 'admin';

  if (activeUserBadge) {
    activeUserBadge.innerText = `${isAdmin ? '👑' : '👤'} ${state.currentUser.name}`;
  }

  // Tampilkan atau sembunyikan fitur sesuai wewenang
  if (btnOpenProducts) btnOpenProducts.style.display = isAdmin ? 'inline-flex' : 'none';
  if (btnOpenReport) btnOpenReport.style.display = isAdmin ? 'inline-flex' : 'none';
  if (btnOpenSettings) btnOpenSettings.style.display = isAdmin ? 'inline-flex' : 'none';
}

function handleLogin() {
  const username = loginUserSelect ? loginUserSelect.value : '';
  const pin = loginPinInput ? loginPinInput.value.trim() : '';

  if (!username) {
    alert("Silakan pilih user/kasir terlebih dahulu.");
    return;
  }
  if (!pin) {
    alert("Silakan masukkan PIN masuk Anda.");
    if (loginPinInput) loginPinInput.focus();
    return;
  }

  const user = state.users.find(u => u.username === username);
  if (!user) {
    alert("User tidak ditemukan.");
    return;
  }

  if (user.pin !== pin) {
    playBeep(440, 0.25);
    alert("❌ PIN yang Anda masukkan salah!");
    if (loginPinInput) {
      loginPinInput.value = '';
      loginPinInput.focus();
    }
    return;
  }

  // Sukses login
  state.currentUser = user;
  localStorage.setItem(STORAGE_KEYS.ACTIVE_USER, JSON.stringify(user));
  if (loginPinInput) loginPinInput.value = '';
  applyUserRolePermissions();
  playBeep(880, 0.12);
  showToast(`✅ Selamat bertugas, ${user.name}!`);
}

if (loginForm) {
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleLogin();
  });
}
if (btnLoginSubmit) {
  btnLoginSubmit.addEventListener('click', (e) => {
    e.preventDefault();
    handleLogin();
  });
}

if (btnUserMenu) {
  btnUserMenu.addEventListener('click', () => {
    if (!state.currentUser) {
      if (loginOverlay) loginOverlay.classList.remove('hidden');
      return;
    }
    const isAdmin = state.currentUser.role === 'admin';
    if (profileUserName) profileUserName.innerText = state.currentUser.name;
    if (profileUserRole) {
      profileUserRole.innerText = isAdmin ? 'OWNER / ADMIN' : 'KASIR (TRANSAKSI ONLY)';
      profileUserRole.style.color = isAdmin ? 'var(--accent-emerald)' : 'var(--accent-sky)';
      profileUserRole.style.background = isAdmin ? 'rgba(16, 185, 129, 0.15)' : 'rgba(2, 132, 199, 0.15)';
    }
    if (btnOpenManageUsers) {
      btnOpenManageUsers.style.display = isAdmin ? 'inline-flex' : 'none';
    }
    if (userModal) userModal.classList.add('active');
  });
}

if (btnCloseUserModal) {
  btnCloseUserModal.addEventListener('click', () => {
    if (userModal) userModal.classList.remove('active');
  });
}

if (btnLogout) {
  btnLogout.addEventListener('click', () => {
    if (confirm("Keluar dari akun kasir dan ganti shift?")) {
      state.currentUser = null;
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_USER);
      if (userModal) userModal.classList.remove('active');
      if (loginPinInput) loginPinInput.value = '';
      applyUserRolePermissions();
      showToast("Telah keluar dari sistem kasir.");
    }
  });
}

if (btnOpenManageUsers) {
  btnOpenManageUsers.addEventListener('click', () => {
    if (userModal) userModal.classList.remove('active');
    renderUsersList();
    if (manageUsersModal) manageUsersModal.classList.add('active');
  });
}

if (btnCloseManageUsers) {
  btnCloseManageUsers.addEventListener('click', () => {
    if (manageUsersModal) manageUsersModal.classList.remove('active');
  });
}

function renderUsersList() {
  if (!usersListContainer) return;
  let html = '';
  state.users.forEach(u => {
    const isAdmin = u.role === 'admin';
    html += `
      <div class="user-item-card">
        <div>
          <div class="user-item-name">${escapeHtml(u.name)}</div>
          <div class="user-item-meta">
            Username: <b>${escapeHtml(u.username)}</b> • Peran: <span style="color: ${isAdmin ? 'var(--accent-emerald)' : 'var(--accent-sky)'}; font-weight: 700;">${isAdmin ? 'Owner' : 'Kasir'}</span> • PIN: ••••
          </div>
        </div>
        <div>
          <button class="btn-edit-price btn-edit-user" data-username="${escapeHtml(u.username)}">
            ✏️ Ubah PIN
          </button>
        </div>
      </div>
    `;
  });
  usersListContainer.innerHTML = html;

  usersListContainer.querySelectorAll('.btn-edit-user').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const username = e.currentTarget.getAttribute('data-username');
      openEditUserModal(username);
    });
  });
}

if (btnAddNewUser) {
  btnAddNewUser.addEventListener('click', () => {
    if (userFormTitle) userFormTitle.innerText = "➕ Tambah Kasir Baru";
    if (formUserIsEdit) formUserIsEdit.value = "0";
    if (formUserUsername) {
      formUserUsername.value = "";
      formUserUsername.disabled = false;
    }
    if (formUserFullName) formUserFullName.value = "";
    if (formUserPin) formUserPin.value = "";
    if (formUserRole) formUserRole.value = "kasir";
    if (userFormModal) userFormModal.classList.add('active');
  });
}

function openEditUserModal(username) {
  const user = state.users.find(u => u.username === username);
  if (!user) return;
  if (userFormTitle) userFormTitle.innerText = `✏️ Ubah Akun & PIN: ${user.name}`;
  if (formUserIsEdit) formUserIsEdit.value = "1";
  if (formUserUsername) {
    formUserUsername.value = user.username;
    formUserUsername.disabled = true;
  }
  if (formUserFullName) formUserFullName.value = user.name;
  if (formUserPin) formUserPin.value = user.pin;
  if (formUserRole) formUserRole.value = user.role;
  if (userFormModal) userFormModal.classList.add('active');
}

if (btnCloseUserForm) {
  btnCloseUserForm.addEventListener('click', () => {
    if (userFormModal) userFormModal.classList.remove('active');
  });
}

if (btnSaveUser) {
  btnSaveUser.addEventListener('click', async () => {
    const isEdit = formUserIsEdit ? formUserIsEdit.value === "1" : false;
    const username = formUserUsername ? formUserUsername.value.trim().toLowerCase().replace(/\s+/g, '') : '';
    const fullName = formUserFullName ? formUserFullName.value.trim() : '';
    const pin = formUserPin ? formUserPin.value.trim() : '';
    const role = formUserRole ? formUserRole.value : 'kasir';

    if (!username) {
      alert("Username wajib diisi!");
      formUserUsername.focus();
      return;
    }
    if (!fullName) {
      alert("Nama lengkap kasir wajib diisi!");
      formUserFullName.focus();
      return;
    }
    if (!pin || pin.length < 4) {
      alert("PIN wajib diisi minimal 4 digit angka!");
      formUserPin.focus();
      return;
    }

    btnSaveUser.disabled = true;
    btnSaveUser.innerText = "⏳ Menyimpan Akun...";

    try {
      if (!isEdit) {
        const exist = state.users.find(u => u.username.toLowerCase() === username.toLowerCase());
        if (exist) {
          alert(`Username '${username}' sudah digunakan.`);
          btnSaveUser.disabled = false;
          btnSaveUser.innerText = "💾 Simpan Akun Kasir";
          return;
        }

        const sql = `
          INSERT INTO pos_users (username, name, pin, role, is_active, created_at)
          VALUES (?, ?, ?, ?, 1, datetime('now'))
        `;
        await queryTurso(sql, [username, fullName, pin, role]);

        state.users.push({ username, name: fullName, pin, role });
      } else {
        const sql = `
          UPDATE pos_users
          SET name = ?, pin = ?, role = ?
          WHERE username = ?
        `;
        await queryTurso(sql, [fullName, pin, role, username]);

        const u = state.users.find(x => x.username === username);
        if (u) {
          u.name = fullName;
          u.pin = pin;
          u.role = role;
        }
        if (state.currentUser && state.currentUser.username === username) {
          state.currentUser = { ...u };
          localStorage.setItem(STORAGE_KEYS.ACTIVE_USER, JSON.stringify(state.currentUser));
          applyUserRolePermissions();
        }
      }

      localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(state.users));
      renderLoginUserOptions();
      renderUsersList();
      if (userFormModal) userFormModal.classList.remove('active');
      showToast("✅ Akun kasir berhasil disimpan!");
      playBeep(880, 0.1);
    } catch (err) {
      console.error("Gagal simpan user:", err);
      alert("⚠️ Gagal menyimpan akun ke Turso: " + (err.message || err));
    } finally {
      btnSaveUser.disabled = false;
      btnSaveUser.innerText = "💾 Simpan Akun Kasir";
    }
  });
}

// =============================================================================
// 14. ATUR HARGA MANUAL / KHUSUS LEBARAN (ADMIN)
// =============================================================================
const itemPriceModal = document.getElementById('itemPriceModal');
const btnCloseItemPrice = document.getElementById('btnCloseItemPrice');
const overridePriceSku = document.getElementById('overridePriceSku');
const overridePriceInCart = document.getElementById('overridePriceInCart');
const overrideItemName = document.getElementById('overrideItemName');
const overrideItemMeta = document.getElementById('overrideItemMeta');
const overrideOriginalPrice = document.getElementById('overrideOriginalPrice');
const overrideNewPriceInput = document.getElementById('overrideNewPriceInput');
const overrideUpdateMasterCheckbox = document.getElementById('overrideUpdateMasterCheckbox');
const btnSavePriceOverride = document.getElementById('btnSavePriceOverride');

function openPriceOverrideModal(sku, inCart = false) {
  if (!state.currentUser || state.currentUser.role !== 'admin') {
    alert("⚠️ Akses Dibatasi!\nHanya Akun Owner/Admin yang diizinkan untuk mengatur harga khusus/manual.");
    return;
  }

  const masterProduct = state.products.find(p => p.sku === sku);
  const cartItem = inCart ? state.cart.find(c => c.sku === sku) : null;
  const currentItem = cartItem || masterProduct;

  if (!currentItem) {
    showToast("⚠️ Data barang tidak ditemukan");
    return;
  }

  overridePriceSku.value = sku;
  overridePriceInCart.value = inCart ? "1" : "0";
  overrideItemName.innerText = currentItem.name;
  overrideItemMeta.innerText = currentItem.barcode ? `Barcode: ${currentItem.barcode}` : `SKU: ${currentItem.sku}`;
  overrideOriginalPrice.innerText = formatRupiah(masterProduct ? masterProduct.price : currentItem.price);
  overrideNewPriceInput.value = currentItem.price || 0;
  overrideUpdateMasterCheckbox.checked = false;

  itemPriceModal.classList.add('active');
  setTimeout(() => {
    overrideNewPriceInput.focus();
    overrideNewPriceInput.select();
  }, 200);
}

if (btnCloseItemPrice) {
  btnCloseItemPrice.addEventListener('click', () => {
    itemPriceModal.classList.remove('active');
  });
}

if (btnSavePriceOverride) {
  btnSavePriceOverride.addEventListener('click', async () => {
    const sku = overridePriceSku.value;
    const inCart = overridePriceInCart.value === "1";
    const newPrice = parseFloat(overrideNewPriceInput.value);
    const updateMaster = overrideUpdateMasterCheckbox.checked;

    if (isNaN(newPrice) || newPrice < 0) {
      alert("Harga tidak boleh kosong atau negatif!");
      overrideNewPriceInput.focus();
      return;
    }

    const masterProduct = state.products.find(p => p.sku === sku);

    // 1. Terapkan ke keranjang
    if (inCart) {
      const item = state.cart.find(c => c.sku === sku);
      if (item) {
        item.price = newPrice;
        item.subtotal = item.qty * item.price;
        renderCart();
      }
    } else {
      if (masterProduct) {
        addToCart({
          ...masterProduct,
          price: newPrice
        });
      }
    }

    // 2. Jika opsi simpan permanen ke Cloud dipilih
    if (updateMaster && masterProduct) {
      btnSavePriceOverride.disabled = true;
      btnSavePriceOverride.innerText = "⏳ Menyimpan ke Cloud...";
      try {
        const sql = `UPDATE products SET selling_price = ?, updated_at = datetime('now') WHERE sku = ?`;
        await queryTurso(sql, [newPrice, sku]);

        masterProduct.price = newPrice;
        localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(state.products));
        showToast(`✅ Harga '${masterProduct.name}' diubah jadi ${formatRupiah(newPrice)} (Permanen di Cloud)`);
      } catch (err) {
        console.error("Gagal update master:", err);
        alert("⚠️ Gagal simpan ke Cloud: " + (err.message || err));
      } finally {
        btnSavePriceOverride.disabled = false;
        btnSavePriceOverride.innerText = "✓ TERAPKAN HARGA";
      }
    } else {
      showToast(`🏷️ Harga khusus ${formatRupiah(newPrice)} diterapkan (khusus nota ini)`);
    }

    itemPriceModal.classList.remove('active');
    playBeep(880, 0.1);
  });
}

// ==========================================
// 15. EVENT LISTENERS GLOBAL & INISIALISASI
// ==========================================
document.getElementById('btnClearCart').addEventListener('click', clearCart);
document.getElementById('btnSync').addEventListener('click', () => syncWithTurso(true));

window.addEventListener('online', () => {
  setOnlineStatus(true);
  syncWithTurso(false);
});

window.addEventListener('offline', () => {
  setOnlineStatus(false);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.log('SW registration error:', err);
    });
  });
}

function escapeHtml(string) {
  return String(string || '').replace(/[&<>"']/g, function(s) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[s];
  });
}

// Start
document.addEventListener('DOMContentLoaded', () => {
  loadCachedData();
  renderCart();
  syncWithTurso(false);
});
