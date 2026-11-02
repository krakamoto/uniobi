package it.uniai.mobile;

import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.assertion.ViewAssertions.matches;
import static androidx.test.espresso.matcher.ViewMatchers.isDisplayed;
import static androidx.test.espresso.matcher.ViewMatchers.withContentDescription;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;

import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class MainActivitySmokeTest {
    @Test
    public void tabsAndSettingsButtonAreVisible() {
        try (ActivityScenario<MainActivity> ignored = ActivityScenario.launch(MainActivity.class)) {
            onView(withContentDescription("Carica")).check(matches(isDisplayed()));
            onView(withContentDescription("Coda")).check(matches(isDisplayed()));
            onView(withContentDescription("Attività")).check(matches(isDisplayed()));
            onView(withContentDescription("Impostazioni")).check(matches(isDisplayed()));
            onView(withContentDescription("Apri impostazioni")).check(matches(isDisplayed()));
        }
    }
}
