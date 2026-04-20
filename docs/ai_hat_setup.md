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

## Performance Benchmarks (RPi 5 + Hailo-8L)

| Task | CPU Only | With AI Hat |
|------|----------|-------------|
| Image classification | ~400ms | ~15ms |
| Object detection | ~1200ms | ~30ms |
| Text generation (7B model) | ~2 tok/s | ~8 tok/s |
| Question answering | ~3s | ~0.8s |

---

## Compatible Models

The Hailo-8L works best with quantized models compiled for the Hailo architecture.
Pre-compiled models are available at:

- https://github.com/hailo-ai/hailo_model_zoo
- https://github.com/hailo-ai/hailo-rpi5-examples

For LLM inference, Ollama handles the AI Hat automatically when detected.

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
