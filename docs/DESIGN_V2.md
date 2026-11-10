# Kế hoạch nâng cấp đồ họa & cảm giác chơi – Pickle Pop v2

> Mục tiêu: nâng chất lượng hình ảnh và cảm giác đánh bóng lên mức của một game thể thao 3D hoàn chỉnh, đồng thời **chân thật đúng chất pickleball**.
> Tài liệu dành cho người/agent lập trình. Làm theo đúng thứ tự phase, mỗi phase có tiêu chí "Xong khi".

## 0. Nguyên tắc

1. **Thiết kế gốc.** Mọi nhân vật, bảng màu, sân, bố cục giao diện và thông số trong tài liệu này là của Pickle Pop.
2. **Pickleball thật:** vợt pickleball (mặt chữ nhật bo góc, không có lưới căng), bóng nhựa có lỗ, giao bóng **tay dưới**, có cú dink/drop, tư thế chờ vợt trước ngực, khu kitchen.
3. **Hình ảnh và luật phải khớp nhau:** bóng rời khỏi **mặt vợt**, đúng thời điểm vợt chạm. Không được có chuyện bóng tự bay đi khi vợt còn ở xa.
4. Vẫn chạy được khi mở bằng `file://` (không cần build), vẫn giữ online tất định.

---

## 1. Vấn đề của bản v1 và hướng giải quyết

| Hạng mục | Bản v1 | Hướng giải quyết ở v2 | Vì sao cần sửa |
|---|---|---|---|
| **Cầm vợt** | Vợt gắn vào một trục ở vai, chỉ xoay quanh trục đứng. Vợt lơ lửng cạnh người, không có bàn tay nắm | Vai, cánh tay, bàn tay, cán vợt nối với nhau thành chuỗi khớp. Vợt nằm trong lòng bàn tay | Trông như cây kẹo mút dính bên hông |
| **Động tác đánh** | Một kiểu vung duy nhất, quét ngang trong 0,32 giây bất kể bóng ở đâu | 4 kiểu đánh (trên đầu, thuận tay, trái tay, hất thấp), mỗi kiểu 3 pha: vào thế → chạm (tay chĩa tới bóng) → theo đà | Vợt không bao giờ chạm bóng trên màn hình |
| **Nhân vật** | Các khối cầu ghép lại, không có tay chân rõ ràng, không quần áo, đứng im như tượng khi chạy | Thân, áo, quần, băng đô/mũ, tay chân dạng viên nang, bàn chân, mặt bám theo mặt cong của đầu, chớp mắt | Thiếu sức sống và cá tính |
| **Chuyển động** | Chỉ nhún lên xuống | Chạy có vung tay chân, nghiêng người theo hướng chạy, co giãn khi tiếp đất, quay mặt theo bóng, lao người, động tác ăn mừng | Nhân vật trượt trên sân |
| **Hướng bóng** | Không có vệt bay, khó đọc hướng. Bóng bắt đầu bay từ vị trí bóng chứ không phải từ vợt. Cú drive bay phẳng như laser | Vệt dải mờ dần đổi màu theo loại cú, dấu điểm rơi, bóng xoay theo hướng bay | Người chơi không đoán được bóng sẽ đi đâu |
| **Canh thời điểm** | Vòng tròn tính theo khoảng cách tới bóng | Vòng thu hẹp theo **thời gian** còn lại tới lúc chạm dự kiến, khớp với vòng mục tiêu thì ra PERFECT | Khó hiểu, khó canh |
| **Ánh sáng & vật liệu** | Bóng đổ cứng, không có ánh sáng môi trường, không tone mapping, màu phẳng | Tone mapping, màu sRGB, ánh sáng môi trường RoomEnvironment cho vẻ mềm như đất sét, bóng đổ mềm | Trông rẻ tiền |
| **Camera** | Thấp, gần, góc nhìn hẹp | Đặt cao, góc nhìn 42°, bám theo người chơi khi lùi sâu, luôn giữ vạch cuối sân bên kia trong khung | Thấy ít sân, khó phán đoán |
| **Bối cảnh** | Vài khối hình đơn giản | Khán đài đông người xem (InstancedMesh), cây, chậu cây, biển quảng cáo, cửa sổ, sàn có vân, cánh hoa bay | Sân trống trải |
| **Cảm giác khi đánh** | Một vòng tròn nhỏ | Hiệu ứng tóe theo chất lượng cú, hạt bắn, camera rung, khựng hình 75ms khi PERFECT, khán giả reo, chữ PERFECT/Trễ/tên cú nổi ngay cạnh người chơi | Đánh không "đã tay" |
| **Giao diện** | Emoji thay cho avatar | Ảnh chân dung render từ chính model 3D, ảnh xem trước của từng sân | Thiếu đồng bộ |

---

## 2. Quyết định kỹ thuật

### 2.1 Nâng Three.js r128 lên **r147** (vẫn không cần build)
- r147 là bản cuối vẫn có `build/three.min.js` (bản UMD, dùng được bằng script thường) và thư mục `examples/js/` (có `RoomEnvironment.js`). Từ r148 trở đi thư mục `examples/js/` bị xóa.
- r147 có sẵn `CapsuleGeometry`, `PMREMGenerator`, `ACESFilmicToneMapping`.
- CDN (ghim đúng phiên bản, đã kiểm tra đều trả về 200; cdnjs **không có** bản r147):
  - `https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js`
  - `https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/environments/RoomEnvironment.js`
- Nếu sau này cần tone mapping Neutral hoặc WebGPU thì mới chuyển sang ES module kèm một bước build bằng esbuild, và phải bỏ chế độ `file://`. Việc này nằm ngoài phạm vi v2.

### 2.2 Cấu hình dựng hình
```js
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
```
- Tất cả màu khai báo bằng hex sRGB. Sau khi bật `sRGBEncoding`, phải kiểm tra lại toàn bộ bảng màu (bản hiện tại bị nhạt màu khi bật sRGB vì màu chưa được chỉnh cho sRGB).
- Đèn: Hemisphere (trời ấm / đất gỗ, cường độ khoảng 0,6) và một Directional (mặt trời) có shadow camera ôm vừa sân (±8 × ±10), `normalBias 0.02`, `bias -0.0004`.
- Vật liệu: `MeshStandardMaterial` roughness 0,55–0,85, metalness 0, màu pastel bão hòa vừa phải. Ánh sáng môi trường sẽ tạo vẻ "đất sét mềm".
- **3 mức đồ họa** (tự chọn theo máy, có thể đổi trong Cài đặt):

| Mức | pixelRatio | Shadow map | Khán giả | Hạt / cánh hoa |
|---|---|---|---|---|
| Thấp | 1 | tắt (chỉ dùng bóng đổ dạng đốm) | 60 | tắt |
| Vừa (mặc định cho điện thoại / máy ≤4 nhân) | 1,5 | 1024 | 160 | ít |
| Cao | 2 | 2048 | 320 | đủ |

---

## 3. Nhân vật mới (`js/character.js`, thay phần nhân vật trong `world.js`)

### 3.1 Khung xương (đơn vị: m; chiều cao nhân vật khoảng 1,15m, đầu chiếm khoảng 45%)
```
root (vị trí trên sân, xoay hướng mặt)
└─ hips (y 0.30)          ← nhún, nghiêng người
   ├─ torso               ← co giãn (squash/stretch), xoay thân khi đánh
   │  ├─ quần (trụ tròn bo, màu shorts)
   │  ├─ áo (cầu kéo dọc, màu shirt) + viền cổ/thắt lưng (torus, màu accent)
   │  ├─ shoulderR (±0.21, 0.28) → upperArm (capsule) → hand (cầu) → GRIP → paddle
   │  ├─ shoulderL                → upperArm → hand (cầm bóng khi giao)
   │  └─ neck → head (y 0.60)
   │        ├─ đầu (cầu 0.30, hơi dẹt)
   │        ├─ mặt: mắt oval có điểm sáng, má hồng trong suốt, mũi, miệng – đặt bám theo mặt cong của đầu
   │        ├─ tai / đặc điểm loài (có thể ve vẩy)
   │        └─ phụ kiện: băng đô / mũ lưỡi trai / visor (màu accent)
   ├─ hipR (±0.09) → leg (capsule) → shoe (cầu dẹt kéo dài, màu giày)
   └─ hipL
```
- **Mặt bám mặt cong:** viết hàm `onHeadSurface(u, v)` trả về điểm trên ellipsoid của đầu, sau đó dùng `lookAt` hướng ra ngoài. Mắt, má, mũi sẽ ôm theo đầu thay vì dán phẳng như hiện nay.
- **Bảng màu mỗi nhân vật** (giữ 9 nhân vật gốc của Pickle Pop, thêm trang phục): `fur, limbs, inner, shirt, shorts, accent (băng đô/viền), shoes, paddle, paddleEdge, eye, blush` cùng các phần riêng theo loài (`muzzle, beak, spines, patch…`).
- **Thể thao hóa:** áo có số, băng tay, giày thể thao. Mỗi nhân vật có một phụ kiện đầu riêng (Thỏ: visor, Gấu: mũ lưỡi trai ngược, Mèo: băng đô, Heo: nơ, Ếch: kính râm cài trán, Cánh cụt: mũ len, Cáo: băng đô sọc, Gấu trúc: băng đô đỏ, Khủng long: mũ có gai).

### 3.2 Hoạt ảnh thủ tục (không cần file animation)
Một bộ trạng thái nhân vật: `idle | ready | run | shuffle | split | windup | contact | follow | lunge | serve | celebrate | sad`.

| Trạng thái | Mô tả |
|---|---|
| **Ready** (mặc định trong pha bóng) | Gối hơi chùng, **vợt giơ trước ngực, mặt vợt dựng đứng** (tư thế chờ của pickleball), tay trái đỡ nhẹ cổ vợt, thở nhẹ (thân co giãn khoảng 1%) |
| **Run** | Chân vung ±0,75 rad theo `sin(2·phase)`, tay trái vung ngược chiều, hông nhún `0.035·|sin|`, nghiêng thân theo vận tốc (`0.05 × vận tốc cục bộ`). Tốc độ bước tỉ lệ với vận tốc |
| **Shuffle** | Khi di chuyển ngang mà vẫn nhìn về lưới: bước chéo sang bên, không quay người |
| **Split-step** | Khi đối thủ chạm bóng (sự kiện launch của đối phương): bật nhẹ 0,1 giây, co chân, rồi hạ xuống với co giãn 12% |
| **Hướng mặt** | `yaw` hướng về phía lưới, xoay thêm tối đa ±0,5 rad theo vị trí x của bóng, làm mượt |
| **Mắt** | Chớp mắt ngẫu nhiên mỗi 2–5,5 giây (scale y về 0,12 trong 0,12 giây); con ngươi nhìn theo bóng |
| **Tiếp đất** | Co giãn: `scale.y = 1 - 0.12·sin(t/0.16·π)`, scale x/z bù để giữ thể tích |
| **Lunge** (với bóng xa) | Thân đổ về phía bóng 0,6–1,2 rad, chân trước khuỵu, sau đó cần 0,3 giây để hồi lại |
| **Celebrate / Sad** | Sau mỗi điểm: nhảy giơ vợt, xoay vòng / cúi đầu, vai rũ xuống. Đây là nền để làm emote sau này |

### 3.3 Cầm vợt và cú đánh – trọng tâm
**Vợt pickleball** (tỉ lệ theo nhân vật, khoảng 0,24 × 0,17m):
- Mặt vợt: hình chữ nhật bo góc (`THREE.Shape` + `ExtrudeGeometry`, bo cạnh), có viền **edge guard** tối màu, logo "PP" in bằng canvas texture.
- Cổ vợt và **cán quấn** (trụ tròn có texture sọc chéo), có nắp cuối cán.
- Điểm `GRIP` nằm trong lòng bàn tay phải. Cán vợt nối dọc theo cẳng tay, mặt vợt xoay khoảng 30° kiểu cầm continental.

**Bảng tư thế (keypose) cho từng kiểu đánh** – mỗi tư thế là góc Euler của vai, góc xoay thân, độ chùng gối:

| Kiểu đánh (chọn theo vị trí chạm) | Vào thế (windup) | Kết thúc (follow) | Xoay thân |
|---|---|---|---|
| `forehand` (bên phải, cao 0,5–1,4m) | tay ra sau, vợt sau hông | vợt vung qua trước mặt lên vai trái | +0,5 → −0,3 |
| `backhand` (bên trái) | tay vắt chéo trước bụng, vợt bên hông trái | vợt mở ra bên phải | −0,5 → +0,3 |
| `overhead` (> 1,6m) | tay giơ cao sau đầu, khuỷu gập | vợt kéo xuống trước hông trái | +0,45, ngả người ra sau rồi gập tới |
| `low` / dink (< 0,5m) | gối khuỵu sâu, vợt thấp mở mặt | đẩy nhẹ lên phía trước, biên độ nhỏ | ±0,15 |
| `volley` (bóng chưa nảy, gần lưới) | tay gần như giữ nguyên tư thế ready | **đẩy ngắn**, không vung rộng | nhỏ |
| `serve` (tay dưới) | tay trái thả bóng, vợt kéo ra sau dưới thắt lưng | vung từ thấp lên cao, kết thúc ngang vai | +0,3 → −0,2 |

**Đồng bộ vợt chạm bóng (contact sync):**
1. Khi người chơi bấm phím (hoặc bot quyết định đánh), dự đoán **thời điểm và vị trí chạm** `contact = predictContact(launch, player)`: điểm đầu tiên trên đường bóng (≤ 0,6 giây tới) mà bóng nằm trong vùng đánh của người chơi (khoảng cách ngang ≤ tầm với, độ cao hợp lệ, đúng luật 2 nảy và kitchen).
2. Chọn kiểu đánh theo `contact` (độ cao và phía trái/phải so với người).
3. **Windup** (khoảng 0,12 giây): xoay tay về tư thế vào thế (slerp quaternion), xoay thân lấy đà.
4. **Contact** (0,09 giây cuối trước thời điểm chạm): slerp từ tư thế vào thế tới quaternion **chĩa vai → điểm chạm** (IK một khớp, dùng `setFromUnitVectors`). Cho phép nhích hông tối đa 0,3m về phía bóng và nhón chân nếu bóng cao. Bóng được phóng đi từ **tâm mặt vợt** đúng thời điểm này.
5. **Follow** (khoảng 0,28 giây): tới tư thế kết thúc trong 45% thời gian đầu, rồi trở về tư thế ready.
6. Tay trái làm đối trọng (giơ ra khi đánh thuận tay, đỡ vợt khi đánh trái tay).

> Như vậy trên màn hình, mặt vợt luôn chạm đúng quả bóng, và hướng vung của vợt khớp với hướng bóng bay.

---

## 4. Bóng & đường bay (sửa "hướng bóng đi")

### 4.1 Mô hình bóng
- Bóng pickleball màu vàng chanh có **lỗ**: dùng canvas texture vẽ các chấm lỗ (26–40 lỗ phân bố đều theo xoắn Fibonacci) gán vào `map` và `bumpMap`. Phóng to khoảng 1,6 lần so với thật để dễ nhìn.
- Bóng **xoay** quanh trục vuông góc với hướng bay. Tốc độ xoay theo loại cú: topspin cho drive, backspin cho dink/drop.

### 4.2 Vật lý thật hơn (`shared/physics.js` – thay đổi giao thức)
- **Lực cản không khí:** bóng pickleball nhẹ (26g) và có lỗ nên bị cản mạnh. `a_drag = -k·|v|·v`, với `k ≈ 0.035` (đã nhân hệ số chơi game). Ở 15 m/s bóng giảm tốc khoảng 8 m/s², nên cú drive cắm xuống ở cuối đường bay, cú lob bay bồng bềnh.
- **Xoáy (Magnus đơn giản):** `a_spin = s · (ω̂ × v)` với `s` theo loại cú: drive topspin làm bóng chúc xuống, dink/drop backspin làm bóng nổi nhẹ, smash topspin mạnh.
- **Nảy:** hệ số nảy dọc 0,62–0,68 tùy mặt sân. Ma sát ngang: topspin làm bóng trườn tới (vx, vz × 0,85), backspin làm bóng dừng lại (× 0,65).
- **Giải quỹ đạo:** vì có lực cản nên không còn công thức đóng. Dùng **shooting method**: tìm `T` và vận tốc bằng cách lặp 6–10 lần mô phỏng thử với bước 1/240 giây, chỉnh vận tốc theo sai số điểm rơi. Hàm vẫn tất định vì chỉ dùng `+ − × ÷` và `Math.sqrt` (sqrt được IEEE-754 làm tròn chính xác, nên kết quả giống nhau trên mọi trình duyệt và Node).
- **Hình dạng các cú (mục tiêu sau khi tinh chỉnh):**

| Cú | Tốc độ rời vợt | Đỉnh quỹ đạo | Khoảng hở qua lưới | Điểm rơi |
|---|---|---|---|---|
| Drive | 14–19 m/s | 1,1–1,6m | 0,15–0,5m | sâu, cách vạch cuối 0,5–2m |
| Dink | 4–6 m/s | lưới + 0,1–0,35m | thấp | trong kitchen bên kia |
| **Drop (cú mới)** | 7–9 m/s | 1,8–2,4m | 0,3–0,6m | kitchen, từ cuối sân (cú drop thứ 3) |
| Lob | 9–12 m/s | 4–6m | cao | sát vạch cuối |
| Smash | 18–24 m/s | – (đánh xuống) | – | giữa sân, góc dốc |
| Giao bóng tay dưới | 9–13 m/s | 1,5–2,2m | 0,4–0,9m | sâu trong ô chéo |

- **Phím:** thêm cú `drop` vào phím **U / B** (tay cầm: RB, cảm ứng: nút "Drop"). Hoặc tự động chọn: bấm Dink khi đang đứng sau vạch giữa sân thì thành Drop.

### 4.3 Hiển thị hướng bóng
- **Vệt bay (trail ribbon):** lưu 24 vị trí gần nhất. Mỗi khung dựng một dải hướng về phía camera, độ rộng thu nhỏ dần (0,05 → 0) và độ mờ giảm dần (`0.85·(1-h)^1.6`). Màu theo loại cú: drive xanh dương nhạt, dink/drop xanh bạc hà, lob vàng, smash hồng, giao bóng trắng. Vệt mờ dần sau khi bóng nảy.
- **Dấu điểm rơi:** vòng trắng kèm chấm màu, nhịp nhàng khi bóng đang bay về phía mình (tắt được trong Cài đặt).
- **Gợi ý ô giao bóng:** tô sáng mờ ô chéo cần giao vào trong pha giao.
- **Bóng đổ của bóng** đậm hơn khi bóng thấp, nhỏ và nhạt dần khi bóng lên cao.

---

## 5. Cơ chế canh thời điểm mới (shared + client)
- **Vòng theo thời gian:** vòng mục tiêu cố định (r = 0,5m) dưới chân và vòng vàng thu hẹp từ 2,6× về 1× trong 0,6 giây cuối trước `contact` dự kiến.
- **Chất lượng cú đánh theo độ lệch giữa lúc bấm và lúc chạm:**
  - `|Δ| ≤ 0.05s` → **PERFECT** (nhanh hơn, không sai số, có hiệu ứng vàng)
  - `0.05–0.12s` → Tốt
  - bấm sớm hơn mức đó → **Sớm** (bóng đi rộng/dài); bấm muộn → **Trễ** (bóng đi hẹp/ngắn, dễ vào lưới)
- **Hướng ngắm kiểu thật:** chạm sớm thì bóng có xu hướng đi chéo sân, chạm muộn thì đi dọc biên. Phím hướng vẫn chỉnh thêm.
- Bấm khi không dự đoán được điểm chạm hợp lệ → chỉ vung không trúng, kèm chữ "Hụt".
- **Online:** gói `hit` gửi thêm `contactT` (thời điểm chạm dự kiến). Server vẫn kiểm tra như cũ, chỉ cần tính lại `from` theo tâm mặt vợt (cho phép lệch ≤ 0,25m so với bóng). Tăng `PROTOCOL_VERSION` lên 2.

---

## 6. Camera
- **Trong trận (màn ngang):** cao 6,2m, cách 12,4m sau vạch cuối, fov 42°, x = 0,4 × x người chơi. Khi người chơi lùi sâu hơn vạch cuối thì camera lùi theo. Điểm nhìn được tính sao cho vạch cuối sân đối phương nằm sát mép trên khung hình. Làm mượt bằng `lerp(1 - e^{-4dt})`.
- **Màn dọc (điện thoại):** fov 58°, cao 8,4m, cách 12,6m. Màn ngang thấp (chiều cao ≤ 500px): cao 7,6m.
- **Rung camera:** 0,08 cho smash/drive mạnh, 0,16 cho PERFECT, giảm dần (`damp 9/s`).
- **Khựng hình (hit-stop) 75ms** khi PERFECT, chỉ áp dụng offline (tắt được).
- **Camera theo màn hình:** menu xoay chậm quanh sân; màn chọn nhân vật cận cảnh nhân vật (cách 2,6m, cao 1,1m); phòng chờ online thấy các nhân vật đứng hai bên lưới.

---

## 7. Bối cảnh sân (`js/venues/*.js`)
- **Sân pickleball chuẩn:** trong sân xanh dương, ngoài sân xanh lá (hoặc theo chủ đề từng sân). Mặt sân dùng texture canvas có hạt sơn acrylic. Vạch sắc nét. Lưới có **dây giữa (center strap)**, cột lưới và băng viền. Lưới cao 0,86m ở giữa và 0,91m ở cột.
- **Khán giả:** `InstancedMesh` các "fan hạt đậu" (thiết kế riêng của Pickle Pop: thân bo tròn, mắt chấm, cầm cờ nhỏ màu hai đội). Có động tác lắc lư khi chờ, đứng dậy vẫy tay khi có điểm, và "sóng" (wave) khi có pha bóng dài trên 12 chạm.
- **Đạo cụ:** biển quảng cáo (canvas texture "Pickle Pop", "Kitchen Club"…), chậu cây, ghế trọng tài, bình nước, túi vợt, màn hình tỉ số trên tường.
- **Ba sân hiện tại được làm lại**, và thêm 2 sân mới:

| Sân | Chi tiết mới |
|---|---|
| Nhà thi đấu Hoa Mai | sàn gỗ có vân (canvas noise), cửa sổ lớn có nắng chiếu xiên, cây mai trồng chậu, cánh mai rơi |
| Bãi biển Gió Nam | cát có vệt sóng, biển có sóng (shader dịch chuyển đơn giản), cờ bay theo gió, chim hải âu |
| Sân thượng Hoàng Hôn | trời gradient hoàng hôn, toà nhà có cửa sổ sáng, dây đèn lấp lánh, bồn nước, máy lạnh |
| *(mới)* Công viên Lá Me | sân ngoài trời có hàng rào lưới B40, cây me, lá rơi, gió giật |
| *(mới)* Đấu trường Đêm | đèn chiếu sân, khán đài tối, bảng LED, ánh đèn rọi theo bóng ở điểm quyết định |

- Mỗi sân khai báo: `sky, fog, hemi, sun{color,intensity,pos}, envIntensity, wind, ambientParticles`.

---

## 8. Hiệu ứng ("juice")
| Sự kiện | Hiệu ứng |
|---|---|
| Chạm bóng thường | vòng tóe trắng nhỏ tại điểm chạm, tiếng "póc" |
| PERFECT | vòng vàng to, 18 hạt confetti, vòng canh thời điểm lóe sáng, rung camera 0,16, khựng hình 75ms, khán giả reo nhẹ |
| Smash | vệt hồng dày hơn, rung camera, có tiếng "vút" |
| Bóng nảy | bụi nhỏ (trên cát: cát bắn), vết chấm mờ tại chỗ nảy trong 1 giây |
| Bóng chạm lưới | lưới rung (dịch đỉnh lưới theo hình sin giảm dần) |
| Chạy nhanh hoặc tiếp đất | bụi dưới giày, tiếng giày rít trên sàn gỗ |
| Ghi điểm | khán giả đứng dậy, confetti nếu là điểm quyết định, nhân vật ăn mừng hoặc buồn |
| Chữ nổi | "PERFECT / Tốt / Sớm / Trễ / Hụt / Drive / Dink / Drop / Lob / Smash" chiếu lên vị trí màn hình ngay trên đầu người chơi |
| Lời trọng tài | chữ to có viền dày (OUT / LƯỚI / KITCHEN / GIAO HỎNG / IN), bật nảy kiểu cartoon |

## 9. Âm thanh
- Tiếng chạm vợt gồm 2 lớp: tiếng click ngắn (2–4 kHz, 8ms) và tiếng "póc" gỗ (500–800 Hz, 70ms). Cao độ đổi theo lực đánh.
- Tiếng nảy "tóc" của bóng nhựa (khác nhau giữa sàn gỗ, cát và bê tông), tiếng lưới, tiếng còi.
- Tiếng khán giả nền có tăng giảm (noise lọc), tiếng reo khi có điểm, tiếng "ồ" khi bóng chạm vạch.
- Giữ cơ chế tổng hợp bằng WebAudio, không dùng file âm thanh. Có thanh âm lượng trong Cài đặt.

## 10. Giao diện
- **Ảnh chân dung nhân vật** và **ảnh xem trước sân** được render từ chính model 3D bằng một renderer phụ 192×192 (chụp một lần lúc khởi động, lưu dưới dạng dataURL). Bỏ emoji.
- Thẻ hướng dẫn giao bóng ở giữa phía trên, có các nút phím (ví dụ "**J** Drive · **K** Dink · **L** Lob · giữ ←/→ để ngắm").
- Dải chú thích phím dạng nút ở góc dưới trái (máy tính); trên điện thoại có thêm nút Drop.
- Nhãn tên dạng DOM chiếu theo vị trí đầu nhân vật, có icon quả bóng cho người đang giao. Thay cho sprite chữ trong 3D.
- **Màn Cài đặt mới:** mức đồ họa, vòng canh thời điểm, dấu điểm rơi, khựng hình, rung camera, âm lượng, đổi phím.

---

## 11. Thứ tự thực hiện

**Phase A – Nền dựng hình (1–2 ngày):** nâng Three lên r147, cấu hình sRGB, tone mapping, RoomEnvironment, chỉnh lại bảng màu, 3 mức đồ họa, camera mới.
*Xong khi:* ảnh chụp sân trống trông mềm, sáng, màu chuẩn; FPS laptop ≥ 60, điện thoại tầm trung ≥ 40 ở mức Vừa.

**Phase B – Nhân vật & vợt (3–4 ngày):** rig mới, trang phục 9 nhân vật, mặt bám mặt cong, chớp mắt, idle/ready/run/shuffle/split, vợt pickleball cầm trong tay.
*Xong khi:* ảnh cận cảnh từng nhân vật đạt yêu cầu (có màn xem thử nhân vật xoay 360°); khi chạy chân tay vung đúng nhịp, không trượt chân.

**Phase C – Cú đánh đồng bộ (3 ngày):** `predictContact`, bảng tư thế 6 kiểu đánh, windup/contact-IK/follow, bóng phóng từ mặt vợt, giao bóng tay dưới có thả bóng, lunge.
*Xong khi:* quay video chậm 0,25× (puppeteer chụp liên tiếp) thấy mặt vợt chạm đúng bóng ở ≥ 95% cú đánh của cả người chơi và bot.

**Phase D – Vật lý & đường bay (2–3 ngày):** lực cản, xoáy, nảy theo xoáy, shooting solver, cú Drop, cập nhật bot, vệt bay, bóng có lỗ và xoay, dấu điểm rơi, gợi ý ô giao.
*Xong khi:* đo được các thông số trong bảng 4.2 nằm trong khoảng mục tiêu; test tất định Node và trình duyệt cho kết quả trùng nhau; bot đấu bot vẫn ra số chạm mỗi pha hợp lý (Chuyên nghiệp đấu Chuyên nghiệp trung bình 8–14 chạm).

**Phase E – Canh thời điểm mới (1–2 ngày):** vòng theo thời gian, chất lượng Sớm/Tốt/PERFECT/Trễ, hướng ngắm theo thời điểm, chữ nổi. Cập nhật online (PROTOCOL_VERSION 2, trường `contactT`).
*Xong khi:* người chơi mới thử 5 phút tự hiểu được cách ra PERFECT; test online có độ trễ 60±30ms không có cú đánh hợp lệ nào bị từ chối.

**Phase F – Bối cảnh & khán giả (3 ngày):** làm lại 3 sân, thêm 2 sân, khán giả instanced có hoạt ảnh, đạo cụ, hạt môi trường.
*Xong khi:* ảnh chụp mỗi sân ở màn chính không còn khoảng trống, FPS vẫn đạt mục tiêu Phase A.

**Phase G – Hiệu ứng, âm thanh, UI (2–3 ngày):** toàn bộ mục 8–10, ảnh chân dung render 3D, màn Cài đặt.
*Xong khi:* đi hết checklist mục 12.

**Phase H – Tinh chỉnh & đo đạc (2 ngày):** cân bằng độ khó bot theo vật lý mới, kiểm tra hiệu năng trên điện thoại thật, sửa lỗi hiển thị.

> Tổng thời gian ước tính 17–22 ngày công cho một người. Phase A và B có thể làm song song với D (D chỉ chạm vào `shared/`).

## 12. Checklist nghiệm thu hình ảnh
- [ ] Nhân vật có áo, quần, giày, phụ kiện đầu; tay chân thấy rõ; mặt dễ thương, có chớp mắt.
- [ ] Vợt hình chữ nhật bo góc, có edge guard và cán quấn, nằm trong bàn tay; tư thế chờ vợt trước ngực.
- [ ] Cú thuận tay, trái tay, trên đầu, dink, volley, giao tay dưới trông khác nhau rõ ràng.
- [ ] Mặt vợt chạm đúng quả bóng; bóng bay ra từ mặt vợt theo hướng vung.
- [ ] Có vệt bay đổi màu theo cú, dấu điểm rơi, bóng xoay; cú drive cắm xuống ở cuối đường bay, lob bay bồng bềnh.
- [ ] Vòng canh thời điểm thu hẹp theo thời gian, khớp vòng thì ra PERFECT kèm hiệu ứng vàng, rung camera và khựng hình.
- [ ] Ánh sáng mềm, màu tươi không bị nhạt, bóng đổ mềm, không có răng cưa nặng.
- [ ] Camera thấy trọn sân bên kia, bám theo khi lùi sâu; trên điện thoại dọc vẫn thấy đủ sân.
- [ ] Khán giả có chuyển động, phản ứng khi có điểm; mỗi sân có không khí riêng.
- [ ] Ảnh chân dung trong menu là ảnh render 3D của chính nhân vật.
- [ ] FPS: laptop ≥ 60 (mức Cao), điện thoại tầm trung ≥ 40 (mức Vừa).
- [ ] Toàn bộ test hiện có vẫn qua; test tất định mới (lực cản, xoáy) qua; online không có cú đánh hợp lệ nào bị từ chối.

## 13. Rủi ro
| Rủi ro | Cách xử lý |
|---|---|
| Lực cản và xoáy làm solver chậm (bot gọi nhiều) | Bộ giải tối đa 10 vòng × 1–3 giây mô phỏng ≈ 7.000 bước, dưới 1ms; có cache theo launch; bot chỉ giải khi quyết định đánh |
| Lệch tất định giữa các máy khi thêm phép toán | Chỉ dùng `+ − × ÷ sqrt`; test so sánh kết quả Node với trình duyệt (xuất JSON) trên ít nhất 1.000 launch ngẫu nhiên |
| IK làm khớp vai xoắn bất thường | Giới hạn góc vai theo từng kiểu đánh; slerp qua tư thế vào thế thay vì đi thẳng tới điểm chạm |
| Hiệu năng điện thoại khi có khán giả và bóng đổ | Dùng các mức đồ họa; khán giả là InstancedMesh, không đổ bóng; geometry tĩnh được gộp (merge) |
| Online: dự đoán điểm chạm khác nhau giữa client và server | Server không phụ thuộc vào hoạt ảnh, chỉ kiểm tra `from` nằm gần bóng (≤ 0,25m) và đúng luật |
