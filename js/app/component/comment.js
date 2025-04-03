import { gif } from './gif.js';
import { card } from './card.js';
import { like } from './like.js';
import { util } from '../../common/util.js';
import { pagination } from './pagination.js';
import { dto } from '../../connection/dto.js';
import { lang } from '../../common/language.js';
import { storage } from '../../common/storage.js';
import { session } from '../../common/session.js';
import { request, defaultJSON, HTTP_GET, HTTP_POST, HTTP_DELETE, HTTP_PUT, HTTP_STATUS_OK, HTTP_STATUS_CREATED } from '../../connection/request.js';

export const comment = (() => {

    /**
     * @type {ReturnType<typeof storage>|null}
     */
    let owns = null;

    /**
     * @type {ReturnType<typeof storage>|null}
     */
    let user = null;

    /**
     * @type {ReturnType<typeof storage>|null}
     */
    let tracker = null;

    /**
     * @type {ReturnType<typeof storage>|null}
     */
    let showHide = null;

    /**
     * @type {HTMLElement|null}
     */
    let comments = null;

    /**
     * @type {string[]}
     */
    let lastRender = [];

    /**
     * @returns {string}
     */
    const onNullComment = () => {
        const desc = lang
            .on('id', '📢 Yuk, share undangan ini biar makin rame komentarnya! 🎉')
            .on('en', '📢 Let\'s share this invitation to get more comments! 🎉')
            .get();

        return `<div class="text-center p-4 mx-0 mt-0 mb-3 bg-theme-auto rounded-4 shadow"><p class="fw-bold p-0 m-0" style="font-size: 0.95rem;">${desc}</p></div>`;
    };

    /**
     * @param {string} id 
     * @param {boolean} disabled 
     * @returns {void}
     */
    const changeActionButton = (id, disabled) => {
        document.querySelector(`[data-button-action="${id}"]`).childNodes.forEach((e) => {
            e.disabled = disabled;
        });
    };

    /**
     * @param {string} id
     * @returns {void}
     */
    const removeInnerForm = (id) => {
        changeActionButton(id, false);
        document.getElementById(`inner-${id}`).remove();
    };

    /**
     * @param {ReturnType<typeof dto.getCommentResponse>} c
     * @returns {void}
     */
    const addListenerLike = (c) => {
        if (c.comments) {
            c.comments.forEach(addListenerLike);
        }

        const bodyLike = document.getElementById(`body-content-${c.uuid}`);
        bodyLike.addEventListener('touchend', () => like.tapTap(bodyLike));
    };

    /**
     * @param {HTMLButtonElement} button 
     * @returns {void}
     */
    const showOrHide = (button) => {
        const ids = button.getAttribute('data-uuids').split(',');
        const isShow = button.getAttribute('data-show') === 'true';
        const uuid = button.getAttribute('data-uuid');

        if (isShow) {
            button.setAttribute('data-show', 'false');
            button.innerText = `Show replies (${ids.length})`;

            showHide.set('show', showHide.get('show').filter((i) => i !== uuid));
        } else {
            button.setAttribute('data-show', 'true');
            button.innerText = 'Hide replies';

            showHide.set('show', showHide.get('show').concat([uuid]));
        }

        for (const id of ids) {
            showHide.set('hidden', showHide.get('hidden').map((i) => {
                if (i.uuid === id) {
                    i.show = !isShow;
                }

                return i;
            }));

            const cls = document.getElementById(id).classList;
            isShow ? cls.add('d-none') : cls.remove('d-none');
        }
    };

    /**
     * @param {HTMLAnchorElement} anchor 
     * @param {string} uuid 
     * @returns {void}
     */
    const showMore = (anchor, uuid) => {
        const content = document.getElementById(`content-${uuid}`);
        const original = util.base64Decode(content.getAttribute('data-comment'));
        const isCollapsed = anchor.getAttribute('data-show') === 'false';

        content.innerHTML = isCollapsed ? original : original.slice(0, card.maxCommentLength) + '...';
        anchor.innerText = isCollapsed ? 'Sebagian' : 'Selengkapnya';
        anchor.setAttribute('data-show', isCollapsed ? 'true' : 'false');
    };

    /**
     * @param {ReturnType<typeof dto.getCommentResponse>} c
     * @returns {void}
     */
    const fetchTracker = (c) => {
        if (!session.isAdmin()) {
            return;
        }

        if (c.comments) {
            c.comments.forEach(fetchTracker);
        }

        if (c.ip === undefined || c.user_agent === undefined || c.is_admin || tracker.has(c.ip)) {
            return;
        }

        /**
         * @param {string} uuid 
         * @param {string} ip 
         * @param {string} result 
         * @returns {void}
         */
        const setResult = (uuid, ip, result) => {
            document.getElementById(`ip-${uuid}`).innerHTML = `<i class="fa-solid fa-location-dot me-1"></i>${util.escapeHtml(ip)} <strong>${util.escapeHtml(result)}</strong>`;
        };

        request(HTTP_GET, `https://freeipapi.com/api/json/${c.ip}`)
            .default(defaultJSON)
            .then((res) => res.json())
            .then((res) => {
                let result = res.cityName + ' - ' + res.regionName;

                if (res.cityName === '-' && res.regionName === '-') {
                    result = 'localhost';
                }

                tracker.set(c.ip, result);
                setResult(c.uuid, c.ip, result);
            })
            .catch((err) => setResult(c.uuid, c.ip, err.message));
    };

    /**
     * @param {ReturnType<typeof dto.getCommentsResponse>} items 
     * @param {ReturnType<typeof dto.commentShowMore>[]} hide 
     * @returns {ReturnType<typeof dto.commentShowMore>[]}
     */
    const traverse = (items, hide = []) => {
        items.forEach((item) => {
            if (!hide.find((i) => i.uuid === item.uuid)) {
                hide.push(dto.commentShowMore(item.uuid));
            }

            if (item.comments && item.comments.length > 0) {
                traverse(item.comments, hide);
            }
        });

        return hide;
    };

    /**
     * @returns {Promise<ReturnType<typeof dto.getCommentsResponse>>}
     */
    const show = () => {
        if (comments.getAttribute('data-loading') === 'false') {
            comments.setAttribute('data-loading', 'true');
            comments.innerHTML = card.renderLoading().repeat(pagination.getPer());
        }

        return request(HTTP_GET, `/api/v2/comment?per=${pagination.getPer()}&next=${pagination.getNext()}&lang=${lang.getLanguage()}`)
            .token(session.getToken())
            .send(dto.getCommentsResponseV2)
            .then(async (res) => {
                comments.setAttribute('data-loading', 'false');

                for (const u of lastRender) {
                    await gif.remove(u);
                }

                if (res.data.lists.length === 0) {
                    comments.innerHTML = onNullComment();
                    return res;
                }

                lastRender = traverse(res.data.lists).map((i) => i.uuid);
                showHide.set('hidden', traverse(res.data.lists, showHide.get('hidden')));

                let data = '';
                for (const i of res.data.lists) {
                    data += await card.renderContent(i);
                }

                if (res.data.lists.length < pagination.getPer()) {
                    data += onNullComment();
                }

                comments.innerHTML = data;

                res.data.lists.forEach(fetchTracker);
                res.data.lists.forEach(addListenerLike);

                return res;
            })
            .then((res) => {
                pagination.setTotal(res.data.count);
                comments.dispatchEvent(new Event('comment.result'));
                return res;
            });
    };

    /**
     * @param {HTMLButtonElement} button 
     * @returns {Promise<void>}
     */
    const remove = async (button) => {
        if (!confirm('Are you sure?')) {
            return;
        }

        const id = button.getAttribute('data-uuid');

        if (session.isAdmin()) {
            owns.set(id, button.getAttribute('data-own'));
        }

        changeActionButton(id, true);
        const btn = util.disableButton(button);
        const likes = like.getButtonLike(id);
        likes.disabled = true;

        const status = await request(HTTP_DELETE, '/api/comment/' + owns.get(id))
            .token(session.getToken())
            .send(dto.statusResponse)
            .then((res) => res.data.status, () => false);

        if (!status) {
            btn.restore();
            likes.disabled = false;
            return;
        }

        document.querySelectorAll('a[onclick="undangan.comment.showOrHide(this)"]').forEach((n) => {
            const oldUuids = n.getAttribute('data-uuids').split(',');

            if (oldUuids.find((i) => i === id)) {
                const uuids = oldUuids.filter((i) => i !== id).join(',');
                uuids.length === 0 ? n.remove() : n.setAttribute('data-uuids', uuids);
            }
        });

        owns.unset(id);
        document.getElementById(id).remove();

        if (comments.children.length === 0) {
            comments.innerHTML = onNullComment();
        }
    };

    /**
     * @param {HTMLButtonElement} button 
     * @returns {Promise<void>}
     */
    const update = async (button) => {
        const id = button.getAttribute('data-uuid');

        let isPresent = false;
        const presence = document.getElementById(`form-inner-presence-${id}`);
        if (presence) {
            presence.disabled = true;
            isPresent = presence.value === '1';
        }

        let isChecklist = false;
        const badge = document.getElementById(`badge-${id}`);
        if (badge) {
            isChecklist = badge.getAttribute('data-is-presence') === 'true';
        }

        const gifIsOpen = gif.isOpen(id);
        const gifId = gif.getResultId(id);
        const gifCancel = gif.buttonCancel(id);

        if (gifIsOpen && gifId) {
            gifCancel.hide();
        }

        const form = document.getElementById(`form-inner-${id}`);

        if (id && !gifIsOpen && util.base64Encode(form.value) === form.getAttribute('data-original') && isChecklist === isPresent) {
            removeInnerForm(id);
            return;
        }

        if (form) {
            form.disabled = true;
        }

        const cancel = document.querySelector(`[onclick="undangan.comment.cancel(this, '${id}')"]`);
        if (cancel) {
            cancel.disabled = true;
        }

        const btn = util.disableButton(button);

        const status = await request(HTTP_PUT, `/api/comment/${owns.get(id)}?lang=${lang.getLanguage()}`)
            .token(session.getToken())
            .body(dto.updateCommentRequest(presence ? isPresent : null, gifIsOpen ? null : form.value, gifId))
            .send(dto.statusResponse)
            .then((res) => res.data.status, () => false);

        if (form) {
            form.disabled = false;
        }

        if (cancel) {
            cancel.disabled = false;
        }

        if (presence) {
            presence.disabled = false;
        }

        btn.restore();

        if (gifIsOpen && gifId) {
            gifCancel.show();
        }

        if (!status) {
            return;
        }

        if (gifIsOpen && gifId) {
            document.getElementById(`img-gif-${id}`).src = document.getElementById(`gif-result-${id}`)?.querySelector('img').src;
            gifCancel.click();
        }

        removeInnerForm(id);

        if (!gifIsOpen) {
            const showButton = document.querySelector(`[onclick="undangan.comment.showMore(this, '${id}')"]`);
            const original = card.convertMarkdownToHTML(util.escapeHtml(form.value));
            const content = document.getElementById(`content-${id}`);

            if (original.length > card.maxCommentLength) {
                content.innerHTML = showButton?.getAttribute('data-show') === 'false' ? original.slice(0, card.maxCommentLength) + '...' : original;
                content.setAttribute('data-comment', util.base64Encode(original));
                showButton?.classList.replace('d-none', 'd-block');
            } else {
                content.innerHTML = original;
                content.removeAttribute('data-comment');
                showButton?.classList.replace('d-block', 'd-none');
            }
        }

        if (presence) {
            document.getElementById('form-presence').value = isPresent ? '1' : '2';
            storage('information').set('presence', isPresent);
        }

        if (!presence || !badge) {
            return;
        }

        badge.classList.toggle('fa-circle-xmark', !isPresent);
        badge.classList.toggle('text-danger', !isPresent);

        badge.classList.toggle('fa-circle-check', isPresent);
        badge.classList.toggle('text-success', isPresent);
    };

    /**
     * @param {HTMLButtonElement} button 
     * @returns {Promise<void>}
     */
    const send = async (button) => {
        const id = button.getAttribute('data-uuid');

        const name = document.getElementById('form-name');
        let nameValue = name.value;

        if (session.isAdmin()) {
            nameValue = user.get('name');
        }

        if (nameValue.length === 0) {
            alert('Name cannot be empty.');

            if (id) {
                // scroll to form.
                document.getElementById('comment').scrollIntoView({ behavior: 'smooth' });
            }
            return;
        }

        const presence = document.getElementById('form-presence');
        if (!id && presence && presence.value === '0') {
            alert('Please select your attendance status.');
            return;
        }

        const gifIsOpen = gif.isOpen(id ? id : gif.default);
        const gifId = gif.getResultId(id ? id : gif.default);
        const gifCancel = gif.buttonCancel(id);

        if (gifIsOpen && !gifId) {
            alert('Gif cannot be empty.');
            return;
        }

        if (gifIsOpen && gifId) {
            gifCancel.hide();
        }

        const form = document.getElementById(`form-${id ? `inner-${id}` : 'comment'}`);
        if (!gifIsOpen && form.value.length === 0) {
            alert('Comments cannot be empty.');
            return;
        }

        if (!id && name && !session.isAdmin()) {
            name.disabled = true;
        }

        if (!session.isAdmin() && presence && presence.value !== '0') {
            presence.disabled = true;
        }

        if (form) {
            form.disabled = true;
        }

        const cancel = document.querySelector(`[onclick="undangan.comment.cancel(this, '${id}')"]`);
        if (cancel) {
            cancel.disabled = true;
        }

        const btn = util.disableButton(button);
        const isPresence = presence ? presence.value === '1' : true;

        if (!session.isAdmin()) {
            const info = storage('information');
            info.set('name', nameValue);

            if (!id) {
                info.set('presence', isPresence);
            }
        }

        const response = await request(HTTP_POST, `/api/comment?lang=${lang.getLanguage()}`)
            .token(session.getToken())
            .body(dto.postCommentRequest(id, nameValue, isPresence, gifIsOpen ? null : form.value, gifId))
            .send(dto.getCommentResponse)
            .then((res) => res, () => null);

        if (name) {
            name.disabled = false;
        }

        if (form) {
            form.disabled = false;
        }

        if (cancel) {
            cancel.disabled = false;
        }

        if (presence) {
            presence.disabled = false;
        }

        if (gifIsOpen && gifId) {
            gifCancel.show();
        }

        btn.restore();

        if (!response || response.code !== HTTP_STATUS_CREATED) {
            return;
        }

        owns.set(response.data.uuid, response.data.own);

        if (form) {
            form.value = null;
        }

        if (gifIsOpen && gifId) {
            gifCancel.click();
        }

        if (!id) {
            if (pagination.reset()) {
                await show();
                comments.scrollIntoView({ behavior: 'smooth' });
                return;
            }

            pagination.setTotal(pagination.geTotal() + 1);
            if (comments.children.length === pagination.getPer()) {
                comments.lastElementChild.remove();
            }

            response.data.is_admin = session.isAdmin();
            const newComment = await card.renderContent(response.data);

            comments.insertAdjacentHTML('afterbegin', newComment);
            comments.scrollIntoView({ behavior: 'smooth' });
        }

        if (id) {
            showHide.set('hidden', showHide.get('hidden').concat([dto.commentShowMore(response.data.uuid, true)]));
            showHide.set('show', showHide.get('show').concat([id]));

            removeInnerForm(id);

            response.data.is_admin = session.isAdmin();
            document.getElementById(`reply-content-${id}`).insertAdjacentHTML('beforeend', await card.renderInnerContent(response.data));

            const anchorTag = document.getElementById(`button-${id}`).querySelector('a');
            const uuids = [response.data.uuid];

            if (anchorTag) {
                if (anchorTag.getAttribute('data-show') === 'false') {
                    showOrHide(anchorTag);
                }

                anchorTag.remove();
            }

            like.getButtonLike(id).insertAdjacentHTML('beforebegin', card.renderReadMore(id, anchorTag ? anchorTag.getAttribute('data-uuids').split(',').concat(uuids) : uuids));
        }

        addListenerLike(response.data);
    };

    /**
     * @param {HTMLButtonElement} button
     * @param {string} id
     * @returns {Promise<void>}
     */
    const cancel = async (button, id) => {
        const presence = document.getElementById(`form-inner-presence-${id}`);
        const isPresent = presence ? presence.value === '1' : false;

        const badge = document.getElementById(`badge-${id}`);
        const isChecklist = badge && owns.has(id) && presence ? badge.getAttribute('data-is-presence') === 'true' : false;

        util.disableButton(button);

        if (gif.isOpen(id) && ((!gif.getResultId(id) && isChecklist === isPresent) || confirm('Are you sure?'))) {
            await gif.remove(id);
            removeInnerForm(id);
            return;
        }

        const form = document.getElementById(`form-inner-${id}`);
        if (form.value.length === 0 || (util.base64Encode(form.value) === form.getAttribute('data-original') && isChecklist === isPresent) || confirm('Are you sure?')) {
            removeInnerForm(id);
        }
    };

    /**
     * @param {HTMLButtonElement} button 
     * @returns {Promise<void>}
     */
    const reply = async (button) => {
        const id = button.getAttribute('data-uuid');

        if (document.getElementById(`inner-${id}`)) {
            return;
        }

        changeActionButton(id, true);
        const btn = util.disableButton(button);

        await gif.remove(id);
        gif.onOpen(id, () => gif.removeGifSearch(id));
        btn.restore(true);

        document.getElementById(`button-${id}`).insertAdjacentElement('afterend', card.renderReply(id));
    };

    /**
     * @param {HTMLButtonElement} button 
     * @returns {Promise<void>}
     */
    const edit = async (button) => {
        const id = button.getAttribute('data-uuid');

        if (document.getElementById(`inner-${id}`)) {
            return;
        }

        changeActionButton(id, true);
        const btn = util.disableButton(button);

        await request(HTTP_GET, '/api/comment/' + id)
            .token(session.getToken())
            .send(dto.commentResponse)
            .then(async (res) => {
                if (res.code !== HTTP_STATUS_OK) {
                    return res;
                }

                if (res.data.gif_url) {
                    await gif.remove(id);
                }

                const isParent = document.getElementById(id).getAttribute('data-parent') === 'true' && !session.isAdmin();
                document.getElementById(`button-${id}`).insertAdjacentElement('afterend', card.renderEdit(id, res.data.presence, isParent, !!res.data.gif_url));

                if (res.data.gif_url) {
                    gif.onOpen(id, () => {
                        gif.removeGifSearch(id);
                        gif.removeButtonBack(id);
                    });

                    return gif.open(id);
                }

                const formInner = document.getElementById(`form-inner-${id}`);
                formInner.value = res.data.comment;
                formInner.setAttribute('data-original', util.base64Encode(res.data.comment));
                return res;
            });

        btn.restore(true);
    };

    /**
     * @returns {void}
     */
    const init = () => {
        gif.init();
        like.init();
        card.init();
        pagination.init();

        comments = document.getElementById('comments');
        comments.addEventListener('comment.show', show);

        owns = storage('owns');
        user = storage('user');
        tracker = storage('tracker');
        showHide = storage('comment');

        if (!showHide.has('hidden')) {
            showHide.set('hidden', []);
        }

        if (!showHide.has('show')) {
            showHide.set('show', []);
        }
    };

    return {
        gif,
        like,
        pagination,
        init,
        send,
        edit,
        reply,
        remove,
        update,
        cancel,
        show,
        showMore,
        showOrHide,
    };
})();