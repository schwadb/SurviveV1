# Hailo AI Hat Setup for Raspberry Pi 5

The Hailo-8L AI Hat provides up to **13 TOPS** of neural processing acceleration,
significantly speeding up AI inference tasks.

> **Important — Hailo-8L does NOT accelerate LLMs.** The 8L is a *vision*
> accelerator (object detection, segmentation, pose). It cannot run the
> decoder-only transformer kernels that Ollama needs, so `ollama run …` on
> SurviveV1 executes **100% on the Pi's CPU** regardless of whether the 8L
> is installed. Only the newer **Hailo-10H** on the AI HAT+ 2 (40 TOPS,
> 8 GB onboard RAM) supports LLM acceleration, via the `hailo-ollama`
> community backend.
>
> If you have an 8L, keep it for camera / vision workloads; pick smaller
> models (`tinyllama`, `llama3.2:1b`) for the AI assistant.

---

## Hardware Setup

1. Power off your Raspberry Pi 5 completely
2. Attach the Hailo AI Hat to the M.2 HAT+ connector on the Pi 5
3. Secure with the included standoffs
4. The Hailo chip appears as a PCIe device at boot

---

## Verify Hardware

```bash
# Check PCIe device
lspci | grep -i hailo
# Expected: Hailo Technologies Ltd. Hailo-8L AI Processor

# Check device node
ls /dev/hailo*
# Expected: /dev/hailo0
```

---

## Software Installation

```bash
# Install Hailo driver and runtime
sudo bash setup/install_ai_hat.sh

# Or manually:
pip3 install hailort
sudo apt-get install hailort hailort-dev
```

---

## Performance Benchmarks

### Vision tasks (Hailo-8L accelerated)

| Task | CPU Only | With Hailo-8L |
|------|----------|---------------|
| Image classification | ~400ms | ~15ms |
| Object detection (YOLOv8) | ~1200ms | ~30ms |

### LLM inference (CPU only — Hailo-8L cannot accelerate LLMs)

| Model | RPi 5 (4GB) | RPi 5 (8GB) |
|-------|-------------|-------------|
| tinyllama (1.1B) | ~2-3 tok/s | ~3-4 tok/s |
| phi3:mini (3.8B) | ~1-2 tok/s | ~1-2 tok/s |
| llama3.2:1b | ~2-3 tok/s | ~3 tok/s |
| gemma3:1b | ~2-3 tok/s | ~3 tok/s |

### Upgrade path: AI HAT+ 2 (Hailo-10H)

The Raspberry Pi AI HAT+ 2 with Hailo-10H (40 TOPS, 8 GB onboard RAM) **can**
accelerate LLM inference at 1-8 tokens/second for 1-1.5B parameter models via
the `hailo-ollama` community backend. If you upgrade, SurviveV1 will detect
the 10H and enable hardware LLM acceleration automatically.

---

## Compatible Models

### Vision (Hailo-8L)

Pre-compiled vision models are available at:

- https://github.com/hailo-ai/hailo_model_zoo
- https://github.com/hailo-ai/hailo-rpi5-examples

### LLM (CPU via Ollama)

Ollama runs LLMs on the Pi's CPU. The Hailo-8L is **not** used for text generation.

---

## Running Without AI Hat

If you don't have the AI Hat, the system falls back to CPU inference:
- tinyllama: ~2-3 tokens/second on RPi 5
- phi3:mini: ~1-2 tokens/second
- Still very usable for survival queries

Set in config: `SKIP_AI_HAT="true"`

---

## Troubleshooting

**AI Hat not detected:**
```bash
# Check PCIe is enabled
grep -i pcie /boot/config.txt
# Should have: dtparam=pciex1_gen=3

# Enable PCIe if missing:
echo "dtparam=pciex1_gen=3" | sudo tee -a /boot/config.txt
sudo reboot
```

**Slow inference despite AI Hat:**
```bash
# Check Hailo is being used
hailortcli fw-control identify
# Should show device info

# Check Ollama is configured for Hailo
systemctl cat ollama | grep HAILO
```
