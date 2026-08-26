# DuckDuckGo search: ubuntu-desktop meta package depends speech-dispatcher orca screen reader default install

## 1. How to Configure Screen Reader on Ubuntu Desktop
<https://oneuptime.com/blog/post/2026-03-02-how-to-configure-screen-reader-on-ubuntu-desktop/view>

Ubuntu Desktop includes Orca by default. If it is missing or you want a newer version: # Install or reinstall Orca sudo apt update sudo apt install orca -y #. Also install speech-dispatcher and espeak for text-to-speech sudo apt install speech-dispatcher espeak-ng -y #.

## 2. Accessibility stack - Ubuntu Desktop documentation
<https://ubuntu.com/desktop/docs/en/latest/explanation/accessibility-stack/>

Orca is the default screen reader on Ubuntu Desktop. eSpeak and Speech Dispatcher are the speech synthesizers that Orca depends on. When Orca identifies the text, it passes it to the Speech Dispatcher for speech synthesis; the Speech Dispatcher then passes the synthesized speech to eSpeak, which plays the sound.

## 3. Accessibility: How do I set up the Screenreader Orca?
<https://www.tuxedocomputers.com/en/Accessibility-How-do-I-set-up-the-Screenreader-Orca>

Orca provides Braille output through the screen reader BrlTTY and speech output via different speech modules. It also offers screen magnification for users with severely impaired vision. Availability Orca and the speech output software Speech-Dispatcher are already preinstalled in TUXEDO OS, Ubuntu, and many other distributions.

## 4. accessibility - How to stop Ubuntu from talking to me? - Ask Ubuntu
<https://askubuntu.com/questions/378223/how-to-stop-ubuntu-from-talking-to-me>

sudo nano '/etc/default/speech-dispatcher'. Find the lines in speech-dispatcher that say: # Set to yes to start system wide Speech Dispatcher RUN=yes.Kill the "orca" (Screen Reader) process, then you should hear "screen reader off".

## 5. Orca screen reader for Linux - YouTube
<https://www.youtube.com/watch?v=UI76P-KPZec>

Testing your website for accessibility using screen reader technology is a key component for a more inclusive web. Luckily Ubuntu Linux ships with a great free and open source program called Orca that can help you get started without requiring any setup.

## 6. How to disable Ubuntu screen reader
<https://ccm.net/computing/linux/2091-how-to-enable-the-ubuntu-screen-reader/>

The Orca Screen Reader on Ubuntu is a handy tool that uses various combinations of speech synthesis and braille to help the visually impaired read content on their screens. When enabled, the feature provides access to the system's graphical desktop t...

## 7. Orca screen reader manual – Emmabuntüs
<https://emmabuntus.org/orca-screen-reader-manual/>

Orca screen reader manual. PDF version of this manual.The method for configuring Orca to be launched automatically as your preferred screen reader will depend upon which desktop environment you use. To toggle Orca on and off in GNOME, press Super+Alt+S.

## 8. Orca Screen Reader - extensible screen reader - LinuxLinks
<https://www.linuxlinks.com/orcascreenreader/>

Orca Screen Reader (Orca) is a free, open source scriptable screen reader which provides access to applications and toolkits. It provides alternative access to the desktop by using speech synthesis, braille, and magnification.

## 9. getting the orca screen reader working with a raspberry pi
<https://techesoterica.com/getting-the-orca-screen-reader-working-with-a-raspberry-pi/>

As of this writing, speech dispatcher and espeak are not installed by default. sudo apt-get install sox -y Install the sox package for multimedia libraries.Hi, None of the default raspberry pi images include orca. You will have to install orca manually.

## 10. Orca Screen Reader
<https://help.gnome.org/orca/>

Orca Screen Reader. Before You Begin. If you are not yet familiar with the navigation commands provided by your desktop environment, you are encouraged to read that documentation first. Getting Started. Welcome to Orca — Introducing the Orca screen reader.

## 11. Text to Speech on GNU/Linux Part 3: Orca on KDE
<https://www.ubuntubuzz.com/2018/12/text-to-speech-on-gnulinux-part-3-orca-on-kde.html>

gnome-orca. espeak. speech-dispatcher. On Ubuntu family operating systems, you can run the installation commandBeware, default Plasma start menu style is not readable by Orca. You must switch it first to "Application Menu" style.

## 12. How to use the Orca screen reader in Linux | ZDNET
<https://www.zdnet.com/article/how-to-use-the-orca-screen-reader-in-linux/>

Although you can enable the screen reader from here, you'll have to configure it from another app. Screenshot by Jack Wallen/ZDNET. To disable Orca, return to Settings > Accessibility, click the Screen Reader entry, and switch the On/Off switch to the Off position.

## 13. How to Install Talking Arch Linux: Step-by-Step Guide | Develop n Solve
<https://www.developnsolve.com/linux/how-to-install-talking-arch-linux>

Test speech with . Orca screen reader not starting: Confirm Orca is installed and your desktop environment supports it. Run Orca manually to check for errors.

## 14. Bug #914575 “speech-dispatcher grabs alsa hw device” : Bugs...
<https://bugs.launchpad.net/ubuntu/+source/speech-dispatcher/+bug/914575>

~# apt-get remove speech-dispatcher Reading package lists...Yes, it is enabled in /etc/default/speech-dispatcher. > ...or you use a program like the Orca Screen reader, > which causes speech-dispatcher to load automatically. gnome-orca is installed.

## 15. Linux Accessibility: Screen Readers and Magnification
<https://linuxjunkies.org/guides/linux-accessibility-setup>

Set up Orca screen reader, GNOME and KDE magnification, high-contrast themes, and full keyboard navigation on modern Linux desktops including Wayland sessions.

## 16. Accessibility Features - Ubuntu.Fan
<https://ubuntu.fan/en/docs/desktop-use/basics/accessibility>

A detailed guide to Ubuntu 26.04 accessibility features, covering screen reader, screen magnifier, high contrast themes, keyboard assistive features, and other accessibility tool configurations.

## 17. Screen reader - Ubuntu Desktop documentation
<https://ubuntu.com/desktop/docs/en/latest/how-to/accessibility/orca/>

Topics: Accessibility Read the screen aloud- Installing the screen reader, Controlling the screen reader., Read the screen in Braille- Disable speech, Braille display commands, Read a document in a...

## 18. Fix "Speech Dispatcher Library Is Missing" Error on Ubuntu
<https://tutorialforlinux.com/2026/01/22/fix-speech-dispatcher-library-is-missing-error-on-ubuntu/>

Speech Dispatcher is a system-wide text-to-speech service used by Ubuntu desktop environments, accessibility tools, and applications. When the library is missing, speech synthesis fails globally, affecting screen readers, system accessibility features, and any app relying on text-to-speech.

## 19. How to Configure Screen Reader on Ubuntu Desktop - GitHub
<https://github.com/OneUptime/blog/blob/master/posts/2026-03-02-how-to-configure-screen-reader-on-ubuntu-desktop/README.md>

Ubuntu Desktop includes Orca, a free and open-source screen reader developed by the GNOME project. Orca reads aloud the content of the screen using text-to-speech, enables refreshable braille display support, and provides magnification. It is a full-featured accessibility tool that lets visually impaired users interact with the entire desktop environment, applications, and the web.

## 20. Accessibility - Community Help Wiki - Official Ubuntu Documentation
<https://help.ubuntu.com/community/Accessibility>

Activating preinstalled tools If you install the Ubuntu system after booting the Ubuntu Desktop CD with an accessibility option as described above, those features will also be preconfigured to start by default on your newly installed system. The most common accessibility tools such as Orca and onBoard are preinstalled on any standard Ubuntu system and are easy to activate. The screen reader ...

## 21. oneuptime.com
<https://oneuptime.com/blog/post/2026-03-02-how-to-configure-screen-reader-on-ubuntu-desktop/markdown>

# How to Configure Screen Reader on Ubuntu Desktop Configure and use Orca screen reader on Ubuntu Desktop to enable text-to-speech for visually impaired users, including setup, keyboard navigation, and customization options.
