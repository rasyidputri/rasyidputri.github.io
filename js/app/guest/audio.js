import { progress } from './progress.js';
import { util } from '../../common/util.js';
import { request, HTTP_GET } from '../../connection/request.js';

export const audio = (() => {

    /**
     * @type {HTMLButtonElement|null}
     */
    let music = null;

    /**
     * @type {HTMLAudioElement|null}
     */
    let audioEl = null;

    /**
     * @type {string|null}
     */
    let url = null;

    /**
     * @type {Promise<void>|null}
     */
    let canPlay = null;

    let isPlay = false;

    let ttl = 1000 * 60 * 60 * 6;

    const cacheName = 'audio';
    const type = 'audio/mpeg';
    const exp = 'x-expiration-time';

    const statePlay = '<i class="fa-solid fa-circle-pause spin-button"></i>';
    const statePause = '<i class="fa-solid fa-circle-play"></i>';

    /**
     * @returns {Promise<void>}
     */
    const play = async () => {
        if (!navigator.onLine) {
            return;
        }

        music.disabled = true;
        try {
            await canPlay;
            await audioEl.play();
            isPlay = true;
            music.disabled = false;
            music.innerHTML = statePlay;
        } catch (err) {
            isPlay = false;
            alert(err);
        }
    };

    /**
     * @returns {void}
     */
    const pause = () => {
        isPlay = false;
        audioEl.pause();
        music.innerHTML = statePause;
    };

    /**
     * @param {Cache} c 
     * @param {number} retries
     * @param {number} delay
     * @returns {Promise<Blob>}
     */
    const fetchPut = (c, retries = 3, delay = 1000) => request(HTTP_GET, url)
        .default()
        .then((r) => r.blob())
        .then((b) => {
            const headers = new Headers();
            headers.set('Content-Type', type);
            headers.set('Content-Length', String(b.size));
            headers.set(exp, String(Date.now() + ttl));

            return c.put(url, new Response(b, { headers })).then(() => b);
        })
        .catch((err) => {
            if (retries <= 0) {
                throw err;
            }

            console.warn('Retrying fetch:' + url);
            return new Promise((res) => util.timeOut(() => res(fetchPut(c, retries - 1, delay + 1000)), delay));
        });

    /**
     * @returns {Promise<string>}
     */
    const getUrl = () => caches.open(cacheName)
        .then((c) => c.match(url).then((res) => {
            if (!res) {
                return fetchPut(c);
            }

            if (Date.now() <= parseInt(res.headers.get(exp))) {
                return res.blob();
            }

            return c.delete(url).then((s) => s ? fetchPut(c) : res.blob());
        }))
        .then((b) => URL.createObjectURL(b));

    /**
     * @param {number} num
     * @returns {void}
     */
    const setTtl = (num) => {
        ttl = Number(num);
    };

    /**
     * @returns {Promise<void>}
     */
    const init = async () => {
        music = document.getElementById('button-music');
        url = music.getAttribute('data-url');

        document.addEventListener('undangan.open', () => {
            music.style.display = 'block';
        });

        try {
            audioEl = new Audio(await getUrl());
            audioEl.volume = 1;
            audioEl.loop = true;
            audioEl.muted = false;
            audioEl.currentTime = 0;
            audioEl.autoplay = false;
            audioEl.controls = false;

            canPlay = new Promise((res) => audioEl.addEventListener('canplay', res));
            progress.complete('audio');
        } catch {
            progress.invalid('audio');
        }

        music.addEventListener('offline', pause);
        music.addEventListener('click', () => isPlay ? pause() : play());
    };

    return {
        init,
        play,
        setTtl,
    };
})();