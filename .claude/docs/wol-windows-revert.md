# Wake-on-LAN: Windows 側変更点と復元手順

PC を Pi からの WoL で起こせるようにするため、Windows のネットワークアダプタ設定を以下のように変更した。やめたい場合はこのドキュメントを見て元に戻す。

- 対象 NIC: **Realtek Gaming 2.5GbE Family Controller** (有線 / MAC `9C-6B-00-B8-C6-B4`)
- 設定変更日: 2026-06-14

## 設定アクセス手順

PowerShell 管理者権限で:

```powershell
Start-Process devmgmt.msc
```

→ デバイスマネージャ → ネットワーク アダプター → **Realtek Gaming 2.5GbE Family Controller** を右クリック → プロパティ。

---

## 1. 電源の管理タブ

| 設定 | 変更前 | 変更後 | 復元時 |
|---|---|---|---|
| 電力の節約のために、コンピューターでこのデバイスの電源をオフにできるようにする | ☑ (元から) | ☑ | 変更なし |
| このデバイスで、コンピューターのスタンバイ状態を解除できるようにする | ☑ (元から) | ☑ | 変更なし |
| Magic Packet でのみ、コンピューターのスタンバイ状態を解除できるようにする | ☐ (無効だった) | ☑ | **☐ に戻す** |

→ 復元時に元に戻すのは **3 番目だけ** (チェックを外す)。

---

## 2. 詳細設定タブ

項目名は Realtek のドライバ表記。日本語/カタカナ表記の場合は併記。

| プロパティ | 変更前 (デフォルト) | 変更後 | 復元時 |
|---|---|---|---|
| **Wake on Magic Packet** | (要確認) | `Enabled` | デフォルトに戻す (通常は Enabled だが、ユーザー側で Disabled だった可能性あり → その場合 Disabled) |
| **ウェイク・オン・パターン・マッチ** (= Wake on Pattern Match) | `有効` | `無効` | **`有効` に戻す** |
| **WOK とシャットダウンリンク速度** (= Shutdown Wake-On-Lan / WoL & Shutdown Link Speed) | `10 Mbps 優先` | 変更なし | 変更なし |
| **Advanced EEE** (= Energy Efficient Ethernet) | `無効` | 変更なし | 変更なし |

参考: 触らなかった項目
- **Wake on Magic Packet when system** — 無効のまま (変更不要)
- **ウェイク・オン・パターン・パケット** — デフォルトで有効 (変更不要)
- **EEE Max Support Speed** — デフォルトのまま (変更不要)

→ 復元時に元に戻すのは **「ウェイク・オン・パターン・マッチ」を「有効」に戻す** のみ。`Wake on Magic Packet` をいじった場合は元の値に戻す。

---

## 3. 高速スタートアップ (hiberfile)

```powershell
# 変更前 (デフォルト): 有効
powercfg /h off   # 実施: 無効化
```

完全シャットダウンからの WoL の取りこぼし防止のため無効化。

**復元時**:

```powershell
powercfg /h on
```

---

## 4. BIOS (ASRock B760M-HDV/M.2)

**Advanced → ACPI Configuration**:

| 項目 | 変更前 | 変更後 | 復元時 |
|---|---|---|---|
| **PCIE Devices Power On** | Disabled | **Enabled** | **Disabled に戻す** |
| Suspend to RAM | Auto | 変更なし | — |
| RTC Alarm Power On | By OS | 変更なし | — |
| USB Keyboard/Remote Power On | Disabled | 変更なし | — |
| USB Mouse Power On | Disabled | 変更なし | — |

このマザーボードには `Deep Sleep` / `ErP Ready` / `Onboard LAN Power On` 個別項目は存在しない。`PCIE Devices Power On` 1 項目が WoL のマスタースイッチ (Realtek NIC は PCIe バス上にあるため)。

**復元手順**: BIOS → Advanced → ACPI Configuration → `PCIE Devices Power On` を **Disabled** に戻して F10 保存。

---

## 完全に WoL をやめたい場合

1. 上記「電源の管理タブ」「詳細設定タブ」を復元
2. `powercfg /h on` で hiberfile 復活
3. BIOS の WoL 関連項目を Disabled に戻す
4. Pi 側 cron から `wakeonlan` 呼び出しを削除 ([Pi crontab](https://100.85.86.51:3000) を編集)
5. `sudo apt remove wakeonlan` (Pi)

NIC ハードウェアは何も変わらないため、ソフト設定を戻せば WoL 起動しなくなる。
