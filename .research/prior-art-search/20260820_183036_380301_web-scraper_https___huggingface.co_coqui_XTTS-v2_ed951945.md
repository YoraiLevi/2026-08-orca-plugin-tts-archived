# coqui/XTTS-v2 · Hugging Face

*Date: 2023-10-31*

---
title: coqui/XTTS-v2 · Hugging Face
url: https://huggingface.co/coqui/XTTS-v2
hostname: huggingface.co
description: We’re on a journey to advance and democratize artificial intelligence through open source and open science.
sitename: Huggingface
date: 2023-10-31
---
Configuration Parsing Warning:Invalid JSON for config file config.json
ⓍTTS
ⓍTTS is a Voice generation model that lets you clone voices into different languages by using just a quick 6-second audio clip. There is no need for an excessive amount of training data that spans countless hours.
This is the same or similar model to what powers Coqui Studio and Coqui API.
Features
- Supports 17 languages.
- Voice cloning with just a 6-second audio clip.
- Emotion and style transfer by cloning.
- Cross-language voice cloning.
- Multi-lingual speech generation.
- 24khz sampling rate.
Updates over XTTS-v1
- 2 new languages; Hungarian and Korean
- Architectural improvements for speaker conditioning.
- Enables the use of multiple speaker references and interpolation between speakers.
- Stability improvements.
- Better prosody and audio quality across the board.
Languages
XTTS-v2 supports 17 languages: English (en), Spanish (es), French (fr), German (de), Italian (it), Portuguese (pt), Polish (pl), Turkish (tr), Russian (ru), Dutch (nl), Czech (cs), Arabic (ar), Chinese (zh-cn), Japanese (ja), Hungarian (hu), Korean (ko) Hindi (hi).
Stay tuned as we continue to add support for more languages. If you have any language requests, feel free to reach out!
Code
The code-base supports inference and fine-tuning.
Demo Spaces
- XTTS Space : You can see how model performs on supported languages, and try with your own reference or microphone input
- XTTS Voice Chat with Mistral or Zephyr : You can experience streaming voice chat with Mistral 7B Instruct or Zephyr 7B Beta
| 🐸💬 CoquiTTS | coqui/TTS on Github | 
| 💼 Documentation | ReadTheDocs | 
| 👩💻 Questions | GitHub Discussions | 
| 🗯 Community | Discord | 
License
This model is licensed under Coqui Public Model License. There's a lot that goes into a license for generative models, and you can read more of the origin story of CPML here.
Contact
Come and join in our 🐸Community. We're active on Discord and Twitter. You can also mail us at info@coqui.ai.
Using 🐸TTS API:
from TTS.api import TTS
tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2", gpu=True)
# generate speech by cloning a voice using default settings
tts.tts_to_file(text="It took me quite a long time to develop a voice, and now that I have it I'm not going to be silent.",
                file_path="output.wav",
                speaker_wav="/path/to/target/speaker.wav",
                language="en")
Using 🐸TTS Command line:
 tts --model_name tts_models/multilingual/multi-dataset/xtts_v2 \
     --text "Bugün okula gitmek istemiyorum." \
     --speaker_wav /path/to/target/speaker.wav \
     --language_idx tr \
     --use_cuda true
Using the model directly:
from TTS.tts.configs.xtts_config import XttsConfig
from TTS.tts.models.xtts import Xtts
config = XttsConfig()
config.load_json("/path/to/xtts/config.json")
model = Xtts.init_from_config(config)
model.load_checkpoint(config, checkpoint_dir="/path/to/xtts/", eval=True)
model.cuda()
outputs = model.synthesize(
    "It took me quite a long time to develop a voice and now that I have it I am not going to be silent.",
    config,
    speaker_wav="/data/TTS-public/_refclips/3.wav",
    gpt_cond_len=3,
    language="en",
)
- Downloads last month
- 8,489,892